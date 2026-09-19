# 第 5 章：设计一致性哈希

## 引言
本章介绍一致性哈希。这项技术通过将请求和数据高效分布到多台服务器，支持水平扩展。增加或移除服务器时，它能尽量减少数据迁移，并通过均衡分布缓解服务器热点。

## 重新哈希的问题
### 说明
传统哈希方法如 `serverIndex = hash(key) % N`，在服务器数量变化时会引发大量数据重新分配。例如：
- 移除服务器会使大多数键重新分配，造成缓存未命中。
- 添加服务器会造成不必要的键迁移。

  <img src="./images/server-hashing.png"  alt="服务器哈希" width="450">

- 服务器池大小固定时，这种方法效果不错；添加或移除服务器时则会出现问题。

  <img src="./images/server-hashing-miss.png"  alt="服务器哈希未命中" width="450">

### 核心问题
服务器数量一变，大多数键就要重新分配，既低效又可能造成过载。

## 一致性哈希
### 定义
一致性哈希使服务器增减时只需重新映射一部分键，从而减少干扰并提高可扩展性。

### 核心概念
1. **哈希空间与环：** 哈希值分布在从 `0` 到 `2^160-1` 的空间中（例如使用 SHA-1）。将两端连接，即构成哈希环。
    <p align="center">
    <img src="./images/hash-ring.png"  alt="哈希环" width="450">
    </p>

- 使用相同的哈希函数 f，根据服务器 IP 或名称将服务器映射到环上。

    <p align="center">
    <img src="./images/server-ring.png"  alt="服务器环" width="450">
    </p>

1. **查找服务器**
- 从键在环上的位置顺时针查找，遇到的第一台服务器负责该键。

  <p align="center">
  <img src="./images/server-lookup.png"  alt="查找服务器" width="450">
  </p>

2. **添加与移除服务器**
- 添加服务器时，仅附近的一部分键会迁移到新服务器。

  <p align="center">
  <img src="./images/adding-server.png"  alt="添加服务器" width="450">
  </p>

- 移除服务器时，仅该服务器负责的键需要转移到顺时针方向的下一台服务器。

  <p align="center">
  <img src="./images/removing-server.png"  alt="移除服务器" width="450">
  </p>

## 挑战与解决方案
### 基础方法的两个问题
1. **分区大小不均：** 不同服务器可能负责大小差异明显的数据分区。
2. **键分布不均：** 某些服务器可能收到远多于其他服务器的键。

### 解决方案：虚拟节点
- 每台服务器在环上由多个均匀分布的虚拟节点表示。
- 虚拟节点可改善键分布并平衡负载。虚拟节点越多，分布的标准差越小，数据也越均衡。

  <p align="center">
  <img src="./images/virtual-nodes.png"   alt="虚拟节点" width="450">
  </p>

## 受影响的键
添加或移除服务器时：
- **添加服务器：** 受影响的是新服务器与其前驱之间的键。下例中，服务器 4 加入环后，从新节点 s4 逆时针到 s3 之间的键需要迁移到 s4。

  <p align="center">
  <img src="./images/server-addition.png"   alt="添加服务器" width="450">
  </p>

- **移除服务器：** 受影响的是被移除服务器与其前驱之间的键。下例中移除 s1 后，从 s1 逆时针到 s0 之间的键需要重新分配给 s2。

  <p align="center">
  <img src="./images/server-removed.png"   alt="移除服务器" width="450">
  </p>

## 一致性哈希的好处
- **减少迁移：** 只需重新分配一部分键。
- **可扩展性：** 支持水平扩展。
- **缓解热点：** 均衡数据分布，避免服务器过载。

## 实际应用
- Amazon Dynamo DB
- Apache Cassandra
- Discord
- Akamai CDN
- Maglev 负载均衡器
