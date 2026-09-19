# 第 23 章：分布式电子邮件服务

## 引言

本章设计类似 **Gmail** 的**分布式电子邮件服务**。2020 年，Gmail 约有 18 亿活跃用户，Outlook 在全球约有 4 亿用户。

---

## 第 1 步：理解问题并确定设计范围

- 候选人：系统有多少用户？
- 面试官：10 亿。
- 候选人：重要功能包括身份验证、收发邮件、获取邮件、过滤、搜索和反垃圾邮件。
- 面试官：很好，暂时不考虑身份验证。
- 候选人：用户如何连接邮件服务器？
- 面试官：通常用 SMTP、POP 或 IMAP；本题使用 HTTP。
- 候选人：邮件能否带附件？
- 面试官：可以。

### 非功能性需求

- **可靠性：**不能丢失数据。
- **可用性：**通过复制消除单点故障，并容忍系统局部故障。
- **可扩展性：**能够承受用户增长。
- **灵活性与可扩展功能：**便于增加新功能，这也是本题选 HTTP 而非传统邮件协议的原因之一。

### 粗略估算

- **10 亿用户。**
- 每人每天发送 10 封邮件，约 **每秒 10 万封**。
- 每人每天收到 40 封，每封平均有 50 KB 元数据，每年约需 **730 PB** 存储。
- 假设 20% 的邮件带附件，附件平均 500 KB，每年约需 **1460 PB**。

---

## 第 2 步：提出总体设计并取得共识

### 邮件基础知识

收发邮件涉及多种协议：

- **SMTP：**在服务器之间发送邮件的标准协议。
- **POP：**从远程服务器接收并下载邮件到本地客户端，获取后会从服务器删除。
- **IMAP：**也用于接收和下载邮件，但会将邮件保留在服务器。
- **HTTPS：**本身不是邮件协议，但 Web 邮件客户端可以使用。

此外，还需为邮件服务器配置 DNS 的 MX 记录：

<div style="margin-left:3rem">
    <img src="./images/dns-lookup.png" alt="dns-lookup" width="500" />
</div>

邮件附件经 Base64 编码发送。多数邮件服务把大小限制在 25 MB 左右；个人与企业账号的限制可能不同，也可配置。

### 传统邮件服务器

用户数量有限、连接单台服务器时，传统邮件服务器可以很好地工作。

<div style="margin-left:3rem">
    <img src="./images/traditional-mail-server.png" alt="traditional-mail-server" width="500" />
</div>

- Alice 登录 Outlook 并点击发送，邮件通过 SMTP 到达 Outlook 服务器。
- Outlook 查询 DNS，找到 gmail.com 的 MX 记录，再通过 SMTP 将邮件转交给 Gmail 服务器。
- Bob 通过 IMAP 或 POP 从 Gmail 服务器获取邮件。

传统服务器把每封邮件作为独立文件存储在本地文件系统：

<div style="margin-left:3rem">
    <img src="./images/local-dir-storage.png" alt="local-dir-storage" width="500" />
</div>

规模增长后，磁盘 I/O 成为瓶颈，而且硬盘损坏或服务器宕机会影响高可用性与可靠性。

### 分布式邮件服务器

分布式邮件服务器解决现代使用场景的扩展问题。它仍可支持原生客户端的 IMAP/POP，以及服务器间交换邮件的 SMTP；功能丰富的 Web 客户端通常使用基于 HTTP 的 REST API。

接口示例：

- `POST /v1/messages`：向 To、Cc、Bcc 中的收件人发信。
- `GET /v1/folders`：返回账号的所有文件夹。

响应示例：

```
[{id: string        文件夹的唯一标识。
  name: string      文件夹名称。根据 RFC6154 [9]，默认文件夹可为
                    All、Archive、Drafts、Flagged、Junk、Sent、Trash。
  user_id: string   账号所有者
}]
```

- `GET /v1/folders/{:folder_id}/messages`：分页返回文件夹内的邮件。
- `GET /v1/messages/{:message_id}`：获取一封邮件的全部信息。

响应示例：

```
{
  user_id: string                      // 账号所有者。
  from: {name: string, email: string}  // 发件人的姓名和地址。
  to: [{name: string, email: string}]  // 收件人的姓名和地址列表。
  subject: string                      // 邮件主题。
  body: string                         // 邮件正文。
  is_read: boolean                     // 是否已读。
}
```

总体架构如下：

<div style="margin-left:3rem">
    <img src="./images/high-level-architecture.png" alt="high-level-architecture" width="500" />
</div>

- **Webmail：**用户在浏览器中收发邮件。
- **Web 服务器：**对外提供请求响应服务，管理登录、注册、用户资料等。
- **实时服务器：**实时向客户端推送新邮件。主要使用 WebSocket，旧浏览器回退到长轮询。
- **元数据数据库：**保存主题、正文、发件人、收件人等。
- **附件存储：**适合大文件的对象存储，如 Amazon S3。
- **分布式缓存：**可用 Redis 缓存近期邮件，改善体验。
- **搜索存储：**支持全文搜索的分布式文档存储。

邮件发送流程：

<div style="margin-left:3rem">
    <img src="./images/email-sending-flow.png" alt="email-sending-flow" width="500" />
</div>

1. 用户写信并点击发送，请求到达负载均衡器。
2. 负载均衡器限制过量发信，并将请求路由至某台 Web 服务器。
3. Web 服务器检查邮件大小等基本条件并先进行垃圾邮件检查。同域收件人可以走内部投递路径。
4. 基本检查通过后，邮件进入消息队列；附件通过对象存储中的引用关联。检查失败则进入错误队列。
5. SMTP 出站工作进程从出站队列读取邮件，检查垃圾邮件和病毒，再投递到目标邮件服务器。
6. 邮件保存在“已发送”文件夹。

要监控出站队列大小。如果持续增长，可能是收件服务器不可用，此时用指数退避稍后重试；也可能是消费者不足，此时增加消费者。

邮件接收流程：

<div style="margin-left:3rem">
    <img src="./images/email-receiving-flkow.png" alt="email-receiving-flow" width="500" />
</div>

1. 收到的邮件到达 SMTP 负载均衡器，分配给 SMTP 服务器。服务器执行接收策略，例如直接丢弃无效邮件。
2. 附件过大时将其放入 S3 等对象存储。
3. 邮件处理工作进程完成初步检查，再将邮件送往持久存储、缓存、对象存储和实时服务器。
4. 离线用户重新上线后，通过 HTTP API 获取新邮件。

---

## 第 3 步：深入设计

### 元数据数据库

邮件元数据有以下特点：邮件头通常较小且访问频繁；正文大小不一，但一般只读一次；大多数操作只涉及单个用户，例如取信、标记已读和搜索；用户主要阅读近期邮件；可靠性要求极高，不能丢失数据。

在 Gmail 或 Outlook 的规模下，通常需要定制数据库，降低每秒 I/O 操作数（IOPS）。可选方案各有限制：

- **关系型数据库：**可给邮件头和正文建索引，但通常更适合较小的数据块。
- **分布式对象存储：**适合备份，却无法高效完成搜索、标记已读等操作。
- **NoSQL：**Gmail 使用 Google Bigtable，但它没有开源。

现有方案很难完全符合需求。面试中无需设计新的分布式数据库，但应指出其目标：单列可达到数 MB；强一致性；减少磁盘 I/O；高可用和容错；便于创建增量备份。

以 `user_id` 作为分区键，让同一用户的数据落在同一分片。这意味着无法让多位用户共享同一封邮件，不过本题没有这个要求。

表的主键由负责数据分布的**分区键**和负责排序的**聚类键**组成。需要支持：获取用户文件夹、列出文件夹内邮件、创建/读取/删除邮件、查询已读/未读邮件，以及可选的会话线程。

下列表结构的图例：

<div style="margin-left:3rem">
    <img src="./images/legend.png" alt="legend" width="500" />
</div>

文件夹表：

<div style="margin-left:3rem">
    <img src="./images/folders-table.png" alt="folders-table" width="500" />
</div>

邮件表：

<div style="margin-left:3rem">
    <img src="./images/emails-table.png" alt="emails-table" width="500" />
</div>

`email_id` 使用 timeuuid，可按邮件创建时间排序。附件放在单独的表中，以文件名标识：

<div style="margin-left:3rem">
    <img src="./images/attachments.png" alt="attachments" width="500" />
</div>

传统关系型数据库易于查找已读或未读邮件，但 Cassandra 不允许按非分区键或非聚类键过滤。先取出文件夹所有邮件再在内存中过滤，规模大时效率很差。因此可把邮件表反规范化为已读表和未读表：

<div style="margin-left:3rem">
    <img src="./images/read-unread-emails.png" alt="read-unread-emails" width="500" />
</div>

要支持会话线程，可保存邮件客户端用于重建线程的邮件头：

```
{
  "headers" {
     "Message-Id": "<7BA04B2A-430C-4D12-8B57-862103C34501@gmail.com>",
     "In-Reply-To": "<CAEWTXuPfN=LzECjDJtgY9Vu03kgFvJnJUSHTt6TW@gmail.com>",
     "References": ["<7BA04B2A-430C-4D12-8B57-862103C34501@gmail.com>"]
  }
}
```

本题对一致性有硬性要求，因此分布式数据库在一致性和可用性之间优先选择一致性。故障切换或网络分区时，受影响用户的同步和更新操作可能暂时不可用。

### 邮件送达率

搭建发信服务器容易，但由于反垃圾邮件算法，真正把信送进收件箱很难。直接用新服务器发信，很可能落入垃圾邮件箱。可采取以下措施：

- **专用 IP：**使用专门的发信 IP，建立收件服务器的信任。
- **邮件分类：**营销邮件与重要邮件分开发送，避免重要邮件被误判。
- **IP 预热：**逐渐增加发送量，建立信誉；新 IP 通常需要 2～6 周。
- **及时封禁垃圾邮件发送者：**防止信誉下降。
- **处理反馈：**与 ISP 建立反馈机制，跟踪投诉率并迅速封禁垃圾账号。
- **邮件认证：**使用 SPF、DKIM 等机制防范网络钓鱼。

不必背下所有措施，但要知道可靠的邮件服务需要大量领域知识。

### 搜索

搜索既包括按正文全文检索，也包括按发件人、收件人、主题、未读状态等条件查询。邮件搜索通常限定在单个用户邮箱中，而且写入多于搜索读取：每次操作都可能触发重新索引，但用户很少打开搜索页。

| | 范围 | 排序 | 准确性 |
|---|---|---|---|
| Google 搜索 | 整个互联网 | 按相关性 | 建索引需要时间，结果并非即时更新 |
| 邮件搜索 | 用户自己的邮箱 | 按时间、日期等属性 | 索引应快速更新，结果应准确 |

一种实现是 Elasticsearch 集群，以 `user_id` 为分区键，将同一用户的数据放在同一节点：

<div style="margin-left:3rem">
    <img src="./images/elasticsearch.png" alt="elasticsearch" width="500" />
</div>

变更操作通过 Kafka 异步处理，解除服务与重新索引流程的耦合；实际搜索则同步执行。Elasticsearch 是成熟的搜索数据库，很适合邮件全文检索。

另一种选择是定制搜索系统。其设计超出本题范围，主要挑战之一是针对写多读少优化。可以用日志结构合并树（LSM Tree）组织磁盘索引，使写入路径以顺序写为主；Cassandra、Bigtable 和 RocksDB 都使用类似技术。基本思路是先把数据放在内存中，达到阈值后合并到下一层磁盘：

<div style="margin-left:3rem">
    <img src="./images/lsm-tree.png" alt="lsm-tree" width="500" />
</div>

两种方案的取舍：Elasticsearch 有一定扩展能力，定制引擎可专门针对邮件场景优化并进一步扩展；Elasticsearch 是元数据存储之外还要维护的服务，定制方案可直接成为数据存储；Elasticsearch 开箱即用，而自研需要大量工程投入。

### 扩展性与可用性

不同用户的操作互不冲突，大多数组件可以独立扩展。为保证高可用，可跨多个数据中心部署，并在故障时由从节点接管主节点：

<div style="margin-left:3rem">
    <img src="./images/multi-dc-example.png" alt="multi-dc-example" width="500" />
</div>

---

## 第 4 步：总结

还可以讨论：

- **容错：**系统许多部分都可能故障，应说明如何处理节点失效。
- **合规：**按照欧洲 GDPR 等法规妥善保存个人身份信息。
- **安全：**邮件加密、网络钓鱼防护、安全浏览等。
- **优化：**例如避免不同用户重复发送同一附件时存储多份。
