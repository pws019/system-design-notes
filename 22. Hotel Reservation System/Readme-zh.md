# 第 22 章：酒店预订系统

## 引言

本章设计一个类似万豪国际的**酒店预订系统**。相同思路也适用于 Airbnb、机票预订和电影票预订。

---

## 第 1 步：理解问题并确定设计范围

开始设计前，应向面试官澄清范围：

- 候选人：系统规模有多大？
- 面试官：为一家拥有 5000 家酒店、100 万间客房的连锁酒店建设网站。
- 候选人：客户预订时付款，还是到店时付款？
- 面试官：预订时全额付款。
- 候选人：只通过网站预订吗？是否支持电话等其他方式？
- 面试官：仅支持网站或应用。
- 候选人：能否取消预订？
- 面试官：可以。
- 候选人：还有其他要求吗？
- 面试官：允许 10% 的超额预订。酒店考虑到客户可能取消，会出售超过实际库存的房间。
- 候选人：时间有限，我们重点设计酒店信息页、客房详情页、客房预订、管理后台和超额预订。
- 面试官：可以。另外，房价经常变化，假设每天都会变。

### 非功能性需求

- **高并发：**旺季可能有大量客户同时预订同一家酒店。
- **适中的延迟：**预订越快越好，但处理几秒钟可以接受。

### 粗略估算

- 共 5000 家酒店、100 万间客房。
- 假设入住率为 70%，平均入住 3 天。
- 每日预订量约为 `100 万 × 0.7 ÷ 3 ≈ 24 万`。
- 每秒预订量约为 `24 万 ÷ 10^5 ≈ 3`，平均预订 TPS 较低。

估算 QPS：假设到预订页要经过三个步骤，每页转化率为 10%。若每秒有 3 笔预订，则预订页约有 30 次浏览，客房详情页约有 300 次浏览。

<div style="margin-left:3rem">
    <img src="./images/qps-estimation.png" alt="qps-estimation" width="500" />
</div>

---

## 第 2 步：提出总体设计并取得共识

下面讨论 API、数据模型和总体架构。

### API 设计

这里仅列出支持酒店预订的核心 REST API。完整系统还需要按大量条件搜索客房等接口，但这些并非本节的技术重点。

**酒店 API**

- `GET /v1/hotels/{id}`：获取酒店详情。
- `POST /v1/hotels`：新增酒店，仅供运营人员使用。
- `PUT /v1/hotels/{id}`：更新酒店信息，仅供运营人员使用。
- `DELETE /v1/hotels/{id}`：删除酒店，仅供运营人员使用。

**客房 API**

- `GET /v1/hotels/{id}/rooms/{id}`：获取客房详情。
- `POST /v1/hotels/{id}/rooms`：新增客房，仅供运营人员使用。
- `PUT /v1/hotels/{id}/rooms/{id}`：更新客房信息，仅供运营人员使用。
- `DELETE /v1/hotels/{id}/rooms/{id}`：删除客房，仅供运营人员使用。

**预订 API**

- `GET /v1/reservations`：获取当前用户的预订历史。
- `GET /v1/reservations/{id}`：获取某笔预订的详情。
- `POST /v1/reservations`：创建预订。
- `DELETE /v1/reservations/{id}`：取消预订。

预订请求示例：

```
{
  "startDate":"2021-04-28",
  "endDate":"2021-04-30",
  "hotelID":"245",
  "roomID":"U12354673389",
  "reservationID":"13422445"
}
```

`reservationID` 是幂等键，用来避免重复预订。详见[并发问题](#并发问题)。

### 数据模型

选择数据库前，先看访问模式。系统需要支持：查看酒店详情；查询某日期范围内可预订的房型；记录预订；查询预订详情和历史。

估算表明系统整体规模不大，但要应对流量突增。我们选择关系型数据库：

- 适合读多写少的系统。访问网站的用户只有一部分会预订，写入量并不大。
- 提供 ACID 保证，有助于防止负余额、重复扣款等问题。
- 数据结构清晰，容易用关系模型表达。

数据库结构如下：

<div style="margin-left:3rem">
    <img src="./images/schema-design.png" alt="schema-design" width="500" />
</div>

大多数列含义明确。需要说明的是 `status`，它表示客房的状态机：

<div style="margin-left:3rem">
    <img src="./images/status-state-machine.png" alt="status-state-machine" width="500" />
</div>

这一模型适合 Airbnb，但酒店客户通常预订的是**房型**，而非某个房间；具体房号在预订时确定。我们会在[改进数据模型](#改进数据模型)中解决这个问题。

### 总体架构

这里采用微服务架构：

<div style="margin-left:3rem">
    <img src="./images/high-level-design.png" alt="high-level-design" width="500" />
</div>

- **用户：**通过手机或电脑预订客房。
- **管理员：**执行退款、取消付款等管理操作。
- **CDN：**缓存 JS、图片、视频等静态资源。
- **公共 API 网关：**提供限流、身份验证等能力。
- **内部 API：**仅向授权人员开放，通常由 VPN 保护。
- **酒店服务：**提供酒店和客房详情。这些数据较少变化，可以积极缓存。
- **房价服务：**提供未来各日房价。某日房价还取决于酒店当日的入住情况。
- **预订服务：**接收预订请求、预留客房，并在预订或取消时更新库存。
- **支付服务：**处理付款，成功后更新预订状态。
- **酒店管理服务：**仅授权人员可用，支持管理和查看预订、酒店等信息。

服务间可以通过 gRPC 等 RPC 框架通信。

---

## 第 3 步：深入设计

重点讨论改进数据模型、并发、扩展性以及微服务间的数据一致性。

### 改进数据模型

前述模型需要调整为预订房型，而非具体房间。预订 API 使用 `roomTypeID` 代替 `roomID`：

```
POST /v1/reservations
{
  "startDate":"2021-04-28",
  "endDate":"2021-04-30",
  "hotelID":"245",
  "roomTypeID":"12354673389",
  "roomCount":"3",
  "reservationID":"13422445"
}
```

更新后的数据结构：

<div style="margin-left:3rem">
    <img src="./images/updated-schema.png" alt="updated-schema" width="500" />
</div>

- **room：**客房信息。
- **room_type_rate：**某房型的价格信息。
- **reservation：**住客的预订数据。
- **room_type_inventory：**客房库存数据。

`room_type_inventory` 表中的列：

- **hotel_id：**酒店 ID。
- **room_type_id：**房型 ID。
- **date：**某一天。
- **total_inventory：**客房总数减去暂时下架的客房数。
- **total_reserved：**指定酒店、房型和日期已预订的客房数。

库存表也可以采用其他设计。按 `(hotel_id, room_type_id, date)` 保存一条记录，便于管理预订和查询。每日定时任务预先生成这些记录。

示例数据：

| hotel_id | room_type_id | date       | total_inventory | total_reserved |
|----------|--------------|------------|-----------------|----------------|
| 211      | 1001         | 2021-06-01 | 100             | 80             |
| 211      | 1001         | 2021-06-02 | 100             | 82             |
| 211      | 1001         | 2021-06-03 | 100             | 86             |
| 211      | 1001         | ...        | ...             |                |
| 211      | 1001         | 2023-05-31 | 100             | 0              |
| 211      | 1002         | 2021-06-01 | 200             | 16             |
| 2210     | 101          | 2021-06-01 | 30              | 23             |
| 2210     | 101          | 2021-06-02 | 30              | 25             |

查询某种房型的库存：

```
SELECT date, total_inventory, total_reserved
FROM room_type_inventory
WHERE room_type_id = ${roomTypeId} AND hotel_id = ${hotelId}
AND date between ${startDate} and ${endDate}
```

考虑到允许超额预订，检查指定数量的客房是否可订：

```
if (total_reserved + ${numberOfRoomsToReserve}) <= 110% * total_inventory
```

估算存储量：5000 家酒店，每家有 20 种房型，保存两年数据，约 `5000 × 20 × 2 × 365 = 7300 万`行。单台数据库服务器可以处理，但可设置跨可用区的只读副本，提高可用性。

如果预订数据大到单个数据库装不下：

- 只保留当前及未来预订，把历史预订移至冷存储。
- 按 `hash(hotel_id) % servers_cnt` 分片，因为查询始终包含 `hotel_id`。

### 并发问题

另一个关键问题是重复预订，包括同一用户两次点击“预订”，以及多个用户同时预订。

<div style="margin-left:3rem">
    <img src="./images/double-booking-single-user.png" alt="double-booking-single-user" width="500" />
</div>

解决用户重复点击有两种方法：

- **客户端处理：**点击后禁用按钮。但禁用 JavaScript 的用户看不到按钮变灰。
- **幂等 API：**通过幂等键，让同一操作即使多次请求也只执行一次。

<div style="margin-left:3rem">
    <img src="./images/idempotency.png" alt="idempotency" width="500" />
</div>

流程如下：用户填写资料、准备预订时，系统生成全局唯一的预订 ID；提交请求时携带这个 `reservation_id`。如果再次点击“完成预订”，后端会收到同一个 ID，并识别重复请求。数据库对 `reservation_id` 设置唯一约束，阻止重复记录。

<div style="margin-left:3rem">
    <img src="./images/unique-constraint-violation.png" alt="unique-constraint-violation" width="500" />
</div>

多个用户同时预订又会怎样？

<div style="margin-left:3rem">
    <img src="./images/double-booking-multiple-users.png" alt="double-booking-multiple-users" width="500" />
</div>

假设事务隔离级别不是可串行化：用户 1 和用户 2 同时预订；两个事务都查询到有空房；事务 2 先预订并更新库存；事务 1 仍看到 100 间中只订出 99 间，于是也预订；两个事务都成功提交。

可通过悲观锁、乐观锁或数据库约束解决。预订 SQL 的基本过程如下：

```sql
# step 1: check room inventory
SELECT date, total_inventory, total_reserved
FROM room_type_inventory
WHERE room_type_id = ${roomTypeId} AND hotel_id = ${hotelId}
AND date between ${startDate} and ${endDate}

# For every entry returned from step 1
if((total_reserved + ${numberOfRoomsToReserve}) > 110% * total_inventory) {
  Rollback
}

# step 2: reserve rooms
UPDATE room_type_inventory
SET total_reserved = total_reserved + ${numberOfRoomsToReserve}
WHERE room_type_id = ${roomTypeId}
AND date between ${startDate} and ${endDate}

Commit
```

#### 方案一：悲观锁

更新记录时加锁，阻止并发更新。MySQL 的 `SELECT... FOR UPDATE` 会锁住查询结果，直到事务提交。

<div style="margin-left:3rem">
    <img src="./images/pessimistic-locking.png" alt="pessimistic-locking" width="500" />
</div>

**优点：**防止其他应用更新正在修改的数据；实现容易，更新串行化后不会冲突，适合严重的数据争用。

**缺点：**锁住多个资源时可能死锁；事务持锁过久会影响其他访问者；查询涉及大量记录且事务持续很久时影响尤其严重。由于扩展性问题，原作者不推荐此方案。

#### 方案二：乐观锁

允许多个用户同时尝试更新记录。常见实现有版本号和时间戳；服务器时钟可能不准确，因此更推荐版本号。

<div style="margin-left:3rem">
    <img src="./images/optimistic-locking.png" alt="optimistic-locking" width="500" />
</div>

给表增加 `version` 列。更新前读取版本号，更新时将其加一并写回；数据库验证版本，若版本不符合预期则拒绝写入。

乐观锁通常比悲观锁快，因为无需锁住数据库记录；但高并发会导致大量回滚，使性能下降。

**优点：**避免覆盖过期数据，无需获取数据库锁，适合更新冲突少的场景。

**缺点：**争用严重时性能较差。由于预订 QPS 并不特别高，本系统可以采用乐观锁。

#### 方案三：数据库约束

此方案与乐观锁相似，但通过数据库约束提供保护：

```
CONSTRAINT `check_room_count` CHECK((`total_inventory - total_reserved` >= 0))
```

<div style="margin-left:3rem">
    <img src="./images/database-constraint.png" alt="database-constraint" width="500" />
</div>

**优点：**实现简单，适合争用较少的情况。

**缺点：**争用严重时性能差；约束不像应用代码那样容易进行版本管理；并非所有数据库都支持约束。对酒店预订系统而言，这也是一个容易实现的可行方案。

### 扩展性

酒店预订系统通常负载不高。但如果扩展为 booking.com 这样的热门旅游网站，QPS 可能增加 1000 倍。这时要先找出瓶颈。无状态服务可以增加副本，数据库有状态，扩展更困难。

一种方法是按 `hotel_id` 进行数据库分片，因为所有查询都会按它过滤。假设总 QPS 为 30000，分成 16 个分片后，每个分片处理 1875 QPS，单个 MySQL 集群可以承受。

<div style="margin-left:3rem">
    <img src="./images/database-sharding.png" alt="database-sharding" width="500" />
</div>

还可以用 Redis 缓存客房库存和预订，并设置 TTL，让过去日期的数据过期。

<div style="margin-left:3rem">
    <img src="./images/inventory-cache.png" alt="inventory-cache" width="500" />
</div>

库存缓存按 `hotel_id`、`room_type_id` 和 `date` 存储：

```
key: hotelID_roomTypeID_{date}
value: the number of available rooms for the given hotel ID, room type ID and date.
```

数据通过 CDC（变更数据捕获）流异步同步：读取数据库变更并应用到另一个系统。Debezium 是将数据库变更同步到 Redis 的常见选择。

因此缓存与数据库可能暂时不一致。数据库仍会阻止无效预订，所以可以接受。不过用户可能要刷新页面才能看到“已无空房”。即使没有缓存延迟，用户犹豫太久也可能遇到相同情况。

**缓存优点：**减少数据库负载；Redis 的内存访问性能高。

**缓存缺点：**缓存与数据库的一致性难以维护，必须考虑不一致对用户体验的影响。

### 服务间的数据一致性

单体应用可以使用共享关系型数据库保证一致性。这里采用折中方案：部分服务独立，但预订和库存 API 由同一服务处理，利用关系型数据库的 ACID 保证。

面试官可能指出，这并非每个服务都拥有独立数据库的纯粹微服务架构：

<div style="margin-left:3rem">
    <img src="./images/microservices-vs-monolith.png" alt="microservices-vs-monolith" width="500" />
</div>

单体服务可借助关系型数据库事务完成原子操作：

<div style="margin-left:3rem">
    <img src="./images/atomicity-monolith.png" alt="atomicity-monolith" width="500" />
</div>

但操作跨越多个服务时，原子性更难保证：

<div style="margin-left:3rem">
    <img src="./images/microservice-non-atomic-operation.png" alt="microservice-non-atomic-operation" width="500" />
</div>

常见解决方法：

- **两阶段提交：**保证多个节点上的事务原子提交，但单个节点变慢可能阻塞所有节点，性能较差。
- **Saga：**一系列局部事务；某步失败时触发补偿事务，最终达到一致。

处理微服务间一致性会增加系统复杂度。应权衡其代价与收益，考虑把相互依赖的操作封装在同一个关系型数据库内是否更合适。

---

## 第 4 步：总结

本章设计了一个酒店预订系统，依次讨论了需求澄清与规模估算、API 和数据模型及总体架构、随需求变化调整数据库结构、并发竞态及悲观锁/乐观锁/约束、数据库分片与缓存，以及微服务间的数据一致性。
