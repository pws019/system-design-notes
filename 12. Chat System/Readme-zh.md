# 第 12 章：设计聊天系统

## 简介
**聊天系统**支持用户之间实时发送消息。本章设计的聊天应用包括：
- **一对一聊天**；
- **群聊（最多 100 人）**；
- **在线状态显示**；
- **多设备支持**；
- **推送通知**。

系统目标规模为 **5000 万日活跃用户（DAU）**，并永久保存聊天记录。

---

## 第一步：理解问题

### 需求
1. **功能：**
   - 一对一聊天及群聊（最多 100 人）。
   - 文本消息（最多 100,000 个字符）。
   - 在线与离线状态显示。
   - 支持多设备。
   - 推送通知。
2. **规模：**5000 万 DAU。
3. **存储：**永久保存聊天记录。

---

## 第二步：概要设计

### 通信协议
1. **发送方：**使用 HTTP 发送消息，并利用持久连接提高效率。

      <div style="margin-left:2rem">
      <img src="./images/basic-design.png" alt="基础设计" width="500">    
      <div>

2. **接收方：**
   - **轮询：**
      - 客户端定期询问服务器是否有新消息。
      - 大量重复请求造成效率低下。

         <img src="./images/polling.png" alt="轮询" width="400">    

   - **长轮询：**
      - 保持连接，直到有消息到达。
      - 对不活跃用户效率不高。

         <img src="./images/long-polling.png" alt="长轮询" width="400">

   - **WebSocket：**
      - 双向持久连接，适合实时通信，因此用于发送和接收消息。
      - 使用 WebSocket（ws）协议传输消息。

         <img src="./images/websocket.png" alt="WebSocket" width="400" >    

---

### 组件

<div style="margin-left:5rem">
   <img src="./images/high-level-stateless-arch.png" alt="无状态架构" height="350">    
   <img src="./images/high-level-statefull-arch.png" alt="有状态架构" height="350" width="550">
</div>

1. **无状态服务：**
   - 处理注册、登录和用户资料管理。
   - 与服务发现集成，为客户端推荐合适的聊天服务器。
2. **有状态服务：**
   - 聊天服务器维持持久的 WebSocket 连接。
   - 负责消息投递和同步。
3. **第三方集成：**
   - 推送服务向用户发送新消息通知。
   - 通知实现可参考通知系统一章。

---
### 设计

客户端与聊天服务器保持持久 WebSocket 连接，以便实时通信。

<div style="margin-left:3rem">
      <img src="./images/high-level-design.png" alt="概要设计" width="450"> 
</div>

- 聊天服务器负责发送和接收消息。
- 在线状态服务器管理用户在线与离线状态。
- API 服务器处理登录、注册、修改资料等请求。
- 通知服务器发送推送通知。
- 键值存储保存聊天记录。选择键值存储的原因：
   - 易于水平扩容。
   - 数据访问延迟很低。
   - 关系型数据库处理长尾数据不够理想；索引增大后，随机访问代价较高。
   - Facebook Messenger 和 Discord 等成熟聊天应用也采用键值存储。

以下是一对一聊天与群聊的数据模型：
   - 主键为消息 ID，可用于确定消息顺序。
   - 群聊使用 `(channel_id, message_id)` 作为复合主键。
      - 可以使用 Snowflake 等全局 64 位序列号生成器产生 ID。
      - 更合适的方式是使用局部序列号生成器，使 ID 仅在群内唯一。
      - 因为只需保证一对一会话或群聊内部的消息顺序，局部 ID 已足够。

      <img src="./images/one-to-one-chat.png" alt="一对一聊天设计" width="300">   
      <img src="./images/group-chat.png" alt="群聊设计" width="300">   

## 第三步：详细设计

### 服务发现

<div style="margin-left:3rem">
   <img src="./images/zookeeper.png" alt="ZooKeeper" width="400">   
</div>

- 服务发现的主要职责是根据地理位置、服务器容量等条件，为客户端推荐合适的聊天服务器。
- 使用 **Apache ZooKeeper** 按这些条件分配服务器。
- 这有助于均衡负载并降低延迟。

### 消息传递流程
#### 一对一聊天

1. 用户 A 将消息发送至聊天服务器 1。
2. 聊天服务器 1 为消息分配唯一 ID，并将其保存到键值存储。
3. 如果用户 B 在线，则将消息转发给与用户 B 保持 WebSocket 连接的聊天服务器 2。
4. 如果用户 B 离线，则发送推送通知。

#### 群聊

<div style="margin-left:3rem">
   <img src="./images/group-chat-flow.png" alt="群聊流程" width="400">  
</div>

- 将消息复制到群内每位接收者的收件箱。
- 这样便于同步，但群规模增大时开销会很高。
- 一个接收者可以收到多个发送者的消息；其收件箱（消息同步队列）汇集这些消息。

---

#### 消息同步

许多用户使用多台设备，因此需要跨设备同步消息。每台设备维护 `cur_max_message_id`，记录该设备已获取的最新消息 ID。满足以下两个条件的消息视为新消息：

<div style="margin-left:3rem">
   <img src="./images/message-synchronization.png" alt="消息同步" width="400">  
</div>

- 接收者 ID 等于当前登录用户的 ID。
- 键值存储中的消息 ID 大于 `cur_max_message_id`。

---

### 在线状态
1. **心跳机制：**
   <div style="margin-left:3rem">
      <img src="./images/heartbeat-mechanism.png" alt="心跳机制" width="400"> 
   </div>

   - 客户端定期向在线状态服务器发送心跳，表明自己仍在线。
   - 如果超过阈值时间未收到心跳（如 x = 30），则将用户标记为离线。

2. **扇出模型：**

   <div style="margin-left:3rem">
      <img src="./images/fanout-presence.png" alt="在线状态扇出" width="400"> 
   </div>

   - 使用发布订阅模型向好友推送状态变化，每对好友维护一个频道。
   - 用户 A 的在线状态变化时，向 A-B、A-C 和 A-D 三个频道发布事件。
   - 用户 B、C、D 分别订阅相应频道，从而收到状态更新。
   - 这种设计适合规模较小的好友群体。

---

## 其他考虑
### 扩展性
- **水平扩容：**随用户数量增长增加服务器。
- **负载均衡：**将流量均匀分配到服务器。
- **缓存：**减轻数据库负载，降低延迟。

### 错误处理
- **重试机制：**通过重试和排队处理消息投递失败。
- **服务器故障：**发生故障时通过服务发现分配新服务器。

### 未来扩展
1. **媒体支持：**处理照片和视频，包括压缩与云存储。
2. **端到端加密：**保护消息隐私。
3. **客户端缓存：**减少数据传输，提高性能。
4. **加快加载：**使用地理分布式缓存网络。
