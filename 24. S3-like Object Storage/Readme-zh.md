# 第 24 章：类 S3 对象存储

## 引言

本章设计类似 **Amazon S3** 的**对象存储**服务。存储系统大致分为块存储、文件存储和对象存储。

**块存储**设备在 20 世纪 60 年代出现，HDD 和 SSD 都属于此类。它们通常直接连接服务器，也可通过高速网络协议连接。服务器可以把原始块格式化为文件系统，也可以直接使用这些块。

**文件存储**建立在块存储之上，提供更高层的抽象，方便管理目录和文件。

**对象存储**以性能换取高持久性、巨大规模和低成本，主要面向归档与备份等“冷”数据。它没有分层目录，所有对象处于扁平空间，速度相对较慢。Amazon S3 和 Google GCS 都是云对象存储服务。

<div style="margin-left:3rem">
    <img src="./images/storage-comparison.png" alt="storage-comparison" width="500" />
</div>

| | 块存储 | 文件存储 | 对象存储 |
|---|---|---|---|
| 内容可变 | 是 | 是 | 否（支持对象版本） |
| 成本 | 高 | 中到高 | 低 |
| 性能 | 中高到极高 | 中到高 | 低到中 |
| 一致性 | 强一致性 | 强一致性 | 强一致性 [5] |
| 访问方式 | SAS/iSCSI/FC | 标准文件访问、CIFS/SMB、NFS | REST API |
| 扩展能力 | 中等 | 高 | 极高 |
| 适用场景 | 虚拟机、数据库 | 通用文件系统 | 二进制数据、非结构化数据 |

相关术语：

- **存储桶（Bucket）：**对象的逻辑容器，名称全局唯一。
- **对象（Object）：**桶中的一份数据，包含内容和元数据。
- **版本控制：**在同一个桶内保留同一对象的多个版本。
- **统一资源标识符（URI）：**唯一标识每个资源。
- **服务等级协议（SLA）：**服务商与客户之间的协议。

Amazon S3 标准低频访问存储类别的服务目标：跨多个可用区达到 99.999999999% 的持久性；即使整个可用区被毁，数据仍能保留；设计可用性为 99.9%。

---

## 第 1 步：理解问题并确定设计范围

- 候选人：需要哪些功能？
- 面试官：创建桶、上传和下载对象、版本控制、列出桶内对象。
- 候选人：对象通常有多大？
- 面试官：需要高效存储大对象和小对象。
- 候选人：每年存储多少数据？
- 面试官：100 PB。
- 候选人：能否假设数据持久性为六个 9（99.9999%）、服务可用性为四个 9（99.99%）？
- 面试官：可以。

### 非功能性需求

存储 **100 PB** 数据；达到**六个 9 的持久性**和**四个 9 的可用性**；同时保持可靠性、性能和存储效率，降低成本。

### 粗略估算

瓶颈可能是磁盘容量或每秒 I/O 操作数（IOPS）。假设 20% 为小于 1 MB 的小对象，60% 为 1～64 MB 的中等对象，20% 为超过 64 MB 的大对象。一个 7200 转 SATA 硬盘每秒大约能进行 100～150 次随机寻道。

为简化计算，取三类对象的代表大小分别为 0.5 MB、32 MB 和 200 MB。存储 100 PB（`10^11 MB`），按 40% 的空间利用率计算，约有 **6.8 亿个对象**。若每个对象元数据占 1 KB，元数据约占 **0.68 TB**。

---

## 第 2 步：提出总体设计并取得共识

对象存储有几个特点：

- **对象不可变：**可以删除或替换对象，但不能原地修改。
- **键值存储：**对象 URI 是键，可通过 HTTP 请求获取内容。
- **一次写入、多次读取：**LinkedIn 的一项研究指出，95% 的操作是读取。
- 同时支持大小对象。

其设计类似 UNIX 文件系统：文件名记录在 inode 等结构中，数据块保存在磁盘其他位置；读取时先查元数据，再取内容。对象存储也将元数据与实际内容分开：

<div style="margin-left:3rem">
    <img src="./images/object-store-vs-unix.png" alt="object-store-vs-unix" width="500" />
</div>

这样两类存储就能独立扩展：

<div style="margin-left:3rem">
    <img src="./images/bucket-and-object.png" alt="bucket-and-object" width="500" />
</div>

### 总体设计

<div style="margin-left:3rem">
    <img src="./images/high-level-design.png" alt="high-level-design" width="500" />
</div>

- **负载均衡器：**在服务副本间分发 API 请求。
- **API 服务：**无状态，协调元数据存储、对象存储和 IAM 服务。
- **身份与访问管理（IAM）：**集中负责身份验证、授权和访问控制。
- **数据存储：**按对象 ID（UUID）保存并获取实际数据。
- **元数据存储：**保存对象元数据。

### 上传对象

<div style="margin-left:3rem">
    <img src="./images/uploading-object.png" alt="uploading-object" width="500" />
</div>

1. 客户端用 HTTP PUT 创建名为 `bucket-to-share` 的桶。
2. API 服务向 IAM 核实用户具有写权限，再在元数据存储中创建桶记录，成功后返回响应。
3. 客户端发送 HTTP PUT，请求创建 `script.txt` 对象。
4. API 服务再次验证身份和写权限，随后将对象内容送往数据存储。
5. 数据存储持久化内容并返回 UUID；API 服务在元数据存储中创建包含 `object_id`、`bucket_id`、`bucket_name` 等信息的记录。

上传请求示例：

```
PUT /bucket-to-share/script.txt HTTP/1.1
Host: foo.s3example.org
Date: Sun, 12 Sept 2021 17:51:00 GMT
Authorization: authorization string
Content-Type: text/plain
Content-Length: 4567
x-amz-meta-author: Alex

[4567 bytes of object data]
```

### 下载对象

桶没有真实的目录层级，但可以组合桶名与对象名，模拟目录路径。GET 请求示例：

```
GET /bucket-to-share/script.txt HTTP/1.1
Host: foo.s3example.org
Date: Sun, 12 Sept 2021 18:30:01 GMT
Authorization: authorization string
```

<div style="margin-left:3rem">
    <img src="./images/download-object.png" alt="download-object" width="500" />
</div>

客户端向负载均衡器发送 `GET /bucket-to-share/script.txt`；API 服务通过 IAM 检查读权限；再从元数据存储取得对象 UUID，用它从数据存储读取内容并返回。

---

## 第 3 步：深入设计

### 数据存储

API 服务与数据存储的交互如下：

<div style="margin-left:3rem">
    <img src="./images/data-store-interactions.png" alt="data-store-interactions" width="500" />
</div>

主要组件如下：

<div style="margin-left:3rem">
    <img src="./images/data-store-main-components.png" alt="data-store-main-components" width="500" />
</div>

**数据路由服务**通过 REST 或 gRPC API 访问数据节点集群。它无状态，可通过增加服务器扩展。职责包括：查询放置服务以确定最佳存储节点；从数据节点读取内容并返回给 API 服务；向数据节点写入内容。

**放置服务**决定对象应存在哪些数据节点上，维护描述集群物理拓扑的虚拟集群映射：

<div style="margin-left:3rem">
    <img src="./images/virtual-cluster-map.png" alt="virtual-cluster-map" width="500" />
</div>

它还向所有数据节点发送心跳，判断节点是否应从虚拟集群移除。由于非常关键，建议部署 5 或 7 个副本，以 Paxos 或 Raft 同步。例如 7 节点集群可容忍 3 个节点故障。

**数据节点**保存对象实际内容。多个节点间复制数据，以保证可靠性和持久性。每个节点运行守护进程向放置服务发送心跳，其中包括该节点管理的 HDD/SSD 数量及每个磁盘已存数据量。

#### 数据持久化流程

<div style="margin-left:3rem">
    <img src="./images/data-persistence-flow.png" alt="data-persistence-flow" width="500" />
</div>

1. API 服务将对象内容转给数据存储。
2. 数据路由服务将内容发给主数据节点。
3. 主节点本地保存，并复制到两个从节点；成功复制后响应。
4. 对象 UUID 返回给 API 服务。

给定对象 UUID，可通过一致性哈希确定其副本组。主节点在响应前完成复制，因此以较高延迟换取更强的一致性：

<div style="margin-left:3rem">
    <img src="./images/consistency-vs-latency.png" alt="consistency-vs-latency" width="500" />
</div>

#### 数据组织方式

最简单的方法是每个对象存成一个文件，但大量小文件会浪费 HDD 数据块（典型块大小 4 KB），也会消耗大量 inode，甚至达到操作系统上限。

可以借鉴预写日志（WAL），把多个小对象追加到一个大文件；文件达到数 GB 的容量后再创建新文件：

<div style="margin-left:3rem">
    <img src="./images/wal-optimization.png" alt="wal-optimization" width="500" />
</div>

代价是同一文件的写入必须串行化，多核会相互等待。可让不同文件绑定不同核心，减少锁争用。

#### 对象查找

多个对象共用文件时，数据节点需要一张映射表，记录 `object_id`、所在 `filename`、起始 `file_offset` 和 `object_size`。可选 RocksDB 等文件数据库或传统关系型数据库；由于写少读多，关系型数据库更适合。

若把数据库独立部署为所有数据节点共享的集群，就必须大幅扩容以处理全部请求，还会引入网络延迟。每个数据节点只关心自己的数据，因此可在节点内部部署轻量级文件关系数据库 SQLite。

#### 更新后的持久化流程

<div style="margin-left:3rem">
    <img src="./images/updated-data-persistence-flow.png" alt="updated-data-persistence-flow" width="500" />
</div>

API 服务请求保存对象；数据节点服务把内容追加到 `/data/c` 文件末尾；然后在对象映射表插入新记录。

#### 持久性

要达到六个 9 的持久性，必须分析各种故障。硬件故障可通过多个数据副本应对，但副本也应分布到不同故障域，如不同机架、数据中心和网络，避免一次事故损坏同一故障域内的多台设备：

<div style="margin-left:3rem">
    <img src="./images/failure-domain-isolation.png" alt="failure-domain-isolation" width="500" />
</div>

假设普通 HDD 的年故障率为 0.81%，保存三个副本可达到六个 9 的持久性。还可通过**纠删码**降低成本：利用校验位，在故障时重建丢失的数据位。

<div style="margin-left:3rem">
    <img src="./images/erasure-coding.png" alt="erasure-coding" width="500" />
</div>

可把图中的位看成数据节点；如果其中两个故障，可由剩下四个恢复。纠删码方案很多，本题可使用跨故障域的 **8+4** 方案：

<div style="margin-left:3rem">
    <img src="./images/erasure-coding-across-failure-domains.png" alt="erasure-coding-across-failure-domains" width="500" />
</div>

纠删码可将存储开销降低约 50%，但读取时路由服务必须从多个位置取数据，因此访问更慢：

<div style="margin-left:3rem">
    <img src="./images/erasure-coding-vs-replication.png" alt="erasure-coding-vs-replication" width="500" />
</div>

三副本需要额外 200% 存储空间，8+4 纠删码需要额外 50%。[纠删码可达到十一个 9 的持久性](https://github.com/Backblaze/erasure-coding-durability)，而复制方案约为六个 9；但计算和存储校验位也需要更多算力。复制更适合对延迟敏感的应用；纠删码在成本和持久性上更有吸引力，实现难度也更高。

#### 正确性验证

整个磁盘故障容易发现，但局部数据损坏不易察觉。可以用内容哈希形成的**校验和**验证完整性；本方案对每个文件和每个对象都保存校验和：

<div style="margin-left:3rem">
    <img src="./images/checksums-for-correctness.png" alt="checksums-for-correctness" width="500" />
</div>

采用 8+4 纠删码时，需要分别读取 8 份数据并验证各自的校验和。

### 元数据模型

表结构：

<div style="margin-left:3rem">
    <img src="./images/metadata-data-model.png" alt="metadata-data-model" width="500" />
</div>

需要支持按名称查找对象 ID、按名称插入或删除对象、列出桶内共享同一前缀的对象。通常会限制每位用户创建的桶数，因此桶表较小，单台数据库可容纳，但读吞吐仍需扩展。

对象表可能超出单机容量，因此需要分片。单纯按 `bucket_id` 分片会使包含数十亿对象的桶成为热点；另一种更均匀的分片方式则会拖慢查询。本方案按 `hash(bucket_name, object_name)` 分片，因为大多数查询使用桶名和对象名。不过，列举桶内对象依然会较慢。

### 列举桶内对象

在单个数据库里，可按前缀查询看起来像目录的对象：

```
SELECT * FROM object WHERE bucket_id = "123" AND object_name LIKE `abc/%`
```

分片后可以向所有分片发出查询，再在内存中合并结果。但分页会变复杂，因为每个分片的结果数量不同，必须分别维护 limit 和 offset。

对象存储通常并不以列举操作为优化重点，因此可以接受较慢的列举。另一种方法是专门建立按桶 ID 分片的反规范化列举表，使查询只访问一个数据库实例。

### 对象版本控制

增加类型为 TIMEUUID 的 `object_version` 列，使版本可按时间排序。每个新版本生成新的 `object_id`：

<div style="margin-left:3rem">
    <img src="./images/object-versioning.png" alt="object-versioning" width="500" />
</div>

删除对象时创建一个特殊 `object_id` 的新版本，表示对象已删除；查询返回 404：

<div style="margin-left:3rem">
    <img src="./images/deleting-versioned-object.png" alt="deleting-versioned-object" width="500" />
</div>

### 优化大文件上传

**分段上传**将大文件拆成多个独立上传的部分：

<div style="margin-left:3rem">
    <img src="./images/multipart-upload.png" alt="multipart-upload" width="500" />
</div>

1. 客户端请求开始分段上传，数据存储返回唯一的上传 ID。
2. 客户端拆分大文件，携带上传 ID 分别上传各部分。
3. 每段上传后，数据存储返回标识该段的 ETag（MD5 校验和）。
4. 全部完成后，客户端发出完成请求，其中包含上传 ID、各部分编号和全部 ETag。
5. 数据存储重组对象，可能耗时几分钟，完成后返回成功响应。

不再需要的旧分段可由垃圾回收器清理。

### 垃圾回收

垃圾回收释放不再使用的存储空间。垃圾数据包括：仅标记删除而尚未实际删除的对象；上传中途失败后留下的孤儿分段；校验和不通过的损坏数据。

回收器还要清理副本上的空间。使用复制时，需要从主副本和从副本删除；使用 8+4 纠删码时，需要从全部 12 个节点删除。

可使用**压实**流程：把 `/data/b` 中未删除的对象复制到 `/data/d`；复制完成后通过数据库事务更新 `object_mapping` 表；只在文件增长到一定阈值后压实，避免产生太多小文件。

<div style="margin-left:3rem">
    <img src="./images/compaction.png" alt="compaction" width="500" />
</div>

---

## 第 4 步：总结

本章比较了块存储、文件存储和对象存储，并设计了类似 S3 的服务，涵盖桶内对象的上传、下载、列举和版本控制，以及数据存储、元数据存储、副本复制、纠删码、分段上传和分片。
