# 第 20 章：指标监控与告警系统

## 引言
本章设计一个高度可扩展的**指标监控与告警系统**。它对保证系统的高可用性和可靠性至关重要。

---

## 第 1 步：理解问题并确定设计范围
指标监控系统可能指很多不同的东西。如果面试官只关心基础设施指标，就不应设计日志聚合系统。

先澄清问题：
 - 候选人：系统供谁使用？是大型科技公司的内部监控系统，还是 Datadog 这样的 SaaS？
 - 面试官：仅供内部使用。
 - 候选人：要收集哪些指标？
 - 面试官：CPU 负载、内存、磁盘空间等系统运行指标，也包括每秒请求数等高层指标；业务指标不在范围内。
 - 候选人：被监控基础设施有多大？
 - 面试官：1 亿日活跃用户，1000 个服务器池，每池 100 台机器。
 - 候选人：数据要保存多久？
 - 面试官：假设保留 1 年。
 - 候选人：长期保存时可降低指标数据的分辨率吗？
 - 面试官：新采集指标保留 7 天；接下来 30 天汇总到 1 分钟分辨率；超过 30 天后再汇总到 1 小时分辨率。
 - 候选人：支持哪些告警渠道？
 - 面试官：邮件、电话、PagerDuty 或 Webhook。
 - 候选人：需要收集错误日志或访问日志吗？
 - 面试官：不需要。
 - 候选人：需要支持分布式追踪吗？
 - 面试官：不需要。

### **高层需求与假设**
被监控的基础设施规模很大：
 - 1 亿日活跃用户。
 - 1000 个服务器池 × 每池 100 台机器 × 每台约 100 项指标，合计约 1000 万项指标。
 - 数据保留 1 年。
 - 保留策略：原始数据保存 7 天，1 分钟分辨率数据保存 30 天，1 小时分辨率数据保存 1 年。

可监控多种指标：
 - CPU 负载。
 - 请求数。
 - 内存使用量。
 - 消息队列中的消息数。

### **非功能需求**
 - **可扩展性**：能够容纳更多指标和告警。
 - **低延迟**：仪表盘和告警查询应快速完成。
 - **可靠性**：避免漏掉关键告警。
 - **灵活性**：便于将来集成新技术。

哪些需求不在范围内？
 - **日志监控**：此类场景常用 ELK 技术栈。
 - **分布式追踪**：收集一个请求流经多个服务时的完整生命周期数据。

---

## 第 2 步：提出概要设计并达成共识

### **基础组件**
指标监控与告警系统包含五个核心组件：

<div style="margin-left:3rem">
    <img src="./images/metrics-monitoring-core-components.png" alt="指标监控核心组件" width="500" />
</div>

 - **数据采集**：从不同来源收集指标。
 - **数据传输**：将数据从来源传到监控系统。
 - **数据存储**：整理并保存传入的数据。
 - **告警**：分析数据、发现异常并生成告警。
 - **可视化**：用图形和图表展示数据。

### **数据模型**
指标通常记录为时间序列，即带时间戳的一组值。序列由名称和可选的标签集合标识。

示例 1：生产环境服务器实例 i631 在 20:00 的 CPU 负载是多少？

<div style="margin-left:3rem">
    <img src="./images/metrics-example-1.png" alt="指标示例一" width="500" />
</div>

可用下表标识相应数据：

<div style="margin-left:3rem">
    <img src="./images/metrics-example-1-data.png" alt="指标示例一的数据" width="500" />
</div>

时间序列由指标名称、标签和特定时间的数据点标识。

示例 2：过去 10 分钟，`us-west` 区域所有 Web 服务器的平均 CPU 负载是多少？

```
CPU.load host=webserver01,region=us-west 1613707265 50

CPU.load host=webserver01,region=us-west 1613707265 62

CPU.load host=webserver02,region=us-west 1613707265 43

CPU.load host=webserver02,region=us-west 1613707265 53

...

CPU.load host=webserver01,region=us-west 1613707265 76

CPU.load host=webserver01,region=us-west 1613707265 83
```

这是为回答问题可能从存储中读取的数据。对每行最后一列的值求平均，就能得到平均 CPU 负载。

这种格式称为行协议，Prometheus、OpenTSDB 等监控软件都使用它。

每条时间序列包含：

<div style="margin-left:3rem">
    <img src="./images/time-series-data-example.png" alt="时间序列数据示例" width="500" />
</div>

数据的可视化方式：

<div style="margin-left:3rem">
    <img src="./images/time-series-data-viz.png" alt="时间序列数据可视化" width="500" />
</div>

 - x 轴表示时间。
 - y 轴表示查询的维度，例如指标名称或标签。

访问模式是写入密集、读取突发。系统采集大量指标，但平时很少读取；发生故障等事件时，读取量会突然上升。

数据存储系统是该设计的核心：
 - 不建议使用通用数据库，不过经过专家级调优也可能达到良好规模。
 - NoSQL 数据库理论上可用，但很难设计出能高效存储和查询时间序列的可扩展表结构。

许多数据库专门用于时间序列数据，通常提供专用查询接口：
 - OpenTSDB 是分布式时间序列数据库，但依赖 Hadoop 和 HBase；若没有现成基础设施，使用门槛较高。
 - Twitter 使用 MetricsDB，Amazon 提供 Timestream。
 - InfluxDB 和 Prometheus 是两种很常见的时间序列数据库。
 - 它们都为海量时间序列设计，结合内存缓存和磁盘存储。

InfluxDB 的规模示例：配置 8 核 CPU、32 GB 内存时，每秒可处理超过 25 万次写入：

<div style="margin-left:3rem">
    <img src="./images/influxdb-scale.png" alt="InfluxDB 规模" width="500" />
</div>

面试通常不要求理解指标数据库内部实现，因为这属于专门知识；除非简历中特别提到。

面试时，只要理解指标属于时间序列数据，并了解 InfluxDB 等常见时间序列数据库即可。

时间序列数据库的一项优点是能按标签高效聚合、分析大量数据。例如，InfluxDB 为每个标签建立索引。

但必须控制标签的基数，即避免使用过多不同的标签值。

### **概要设计**

<div style="margin-left:3rem">
    <img src="./images/high-level-design.png" alt="概要设计" width="500" />
</div>

 - **指标来源**：应用服务器、SQL 数据库、消息队列等。
 - **指标采集器**：收集指标并写入时间序列数据库。
 - **时间序列数据库**：按时间序列存储指标，提供分析海量指标的专用查询接口。
 - **查询服务**：简化从时间序列数据库查询和读取数据的过程；如果数据库接口足够强大，可省略它。
 - **告警系统**：将告警通知发送到不同渠道。
 - **可视化系统**：用图形和图表呈现指标。

---

## 第 3 步：深入设计
下面深入讨论系统的几个关键部分。

### **指标采集**
采集指标时，偶尔丢失数据并不严重，客户端可以发送后不等待确认。

<div style="margin-left:3rem">
    <img src="./images/metrics-collection.png" alt="指标采集" width="500" />
</div>

指标采集有两种方式：拉取和推送。

拉取模型如下：

<div style="margin-left:3rem">
    <img src="./images/pull-model-example.png" alt="拉取模型示例" width="500" />
</div>

采集器需要维护最新的服务和指标接口列表，可用 ZooKeeper 或 etcd 提供服务发现。

服务发现保存从何处、何时采集指标的配置规则：

<div style="margin-left:3rem">
    <img src="./images/service-discovery-example.png" alt="服务发现示例" width="500" />
</div>

采集流程细节：

<div style="margin-left:3rem">
    <img src="./images/metrics-collection-flow.png" alt="指标采集流程" width="500" />
</div>

 - 采集器从服务发现获取配置元数据，包括拉取间隔、IP 地址、超时和重试参数。
 - 采集器通过预定义 HTTP 接口（例如 `/metrics`）拉取数据。该接口通常由客户端程序库提供。
 - 采集器也可以向服务发现注册变更通知，在服务接口变化时获知。
 - 另一选择是定期轮询指标接口的配置变化。

目标规模下，单个采集器不够，需要多个实例。同时要协调实例，避免两个采集器重复采集同一指标。

一种做法是把采集器和服务器放到一致性哈希环上，让每组服务器仅由一个采集器负责：

<div style="margin-left:3rem">
    <img src="./images/consistent-hash-ring.png" alt="一致性哈希环" width="500" />
</div>

推送模型中，服务主动将指标发送给采集器：

<div style="margin-left:3rem">
    <img src="./images/push-model-example.png" alt="推送模型示例" width="500" />
</div>

通常会在服务实例旁安装采集代理，由代理收集服务器指标并推送给采集器。

<div style="margin-left:3rem">
    <img src="./images/metrics-collector-agent.png" alt="指标采集代理" width="500" />
</div>

推送前还可在代理处聚合指标，减少采集器处理的数据量。

但采集器负载过高时可能拒绝推送请求，因此应将其放在负载均衡器后面的自动扩缩容组中。

哪种方式更好？两者各有权衡，不同系统也有不同选择：
 - Prometheus 使用拉取架构。
 - Amazon CloudWatch 和 Graphite 使用推送架构。

主要差异如下：
| 对比项 | 拉取 | 推送 |
|---|---|---|
| 调试便利性 | 应用服务器的 `/metrics` 接口可随时查看指标，甚至能在笔记本电脑上查看；拉取更方便。 | 采集器没有收到指标时，原因可能是网络故障。 |
| 健康检查 | 应用服务器不响应拉取，可快速判断它是否故障；拉取更方便。 | 采集器没有收到指标时，原因可能是网络故障。 |
| 短时任务 | 任务持续时间可能不足以等到下一次拉取。 | 某些批处理任务很快结束，推送更合适；拉取模型可用推送网关弥补 [22]。 |
| 防火墙与复杂网络 | 采集器必须能访问所有指标接口，多数据中心部署可能需要更复杂的网络基础设施。 | 若采集器有负载均衡和自动扩缩容，可从各处接收数据；推送更合适。 |
| 性能 | 拉取通常使用 TCP。 | 推送通常使用 UDP，因此传输延迟较低；但建立 TCP 连接的开销相对指标载荷可能很小。 |
| 数据真实性 | 被采集的应用服务器预先写入配置，因此来源可信。 | 任意客户端都可能推送指标；可通过来源白名单或认证解决。 |

没有绝对赢家。大型组织很可能需要同时支持两种方式；某些环境甚至无法安装推送代理。

### **扩展指标传输流水线**

<div style="margin-left:3rem">
    <img src="./images/metrics-transmission-pipeline.png" alt="指标传输流水线" width="500" />
</div>

无论采用推送还是拉取，都将指标采集器部署在自动扩缩容组中。

但如果时间序列数据库宕机，仍可能丢失数据。为降低风险，可以加入队列机制：

<div style="margin-left:3rem">
    <img src="./images/queuing-mechanism.png" alt="队列机制" width="500" />
</div>

 - 指标采集器将数据推送到 Kafka。
 - 消费者或 Apache Storm、Flink、Spark 等流处理服务处理数据，再写入时间序列数据库。

优点：
 - Kafka 是可靠、可扩展的分布式消息平台。
 - 数据采集与数据处理解耦。
 - Kafka 保留数据，可防止数据丢失。

可以按指标名称为 Kafka 配置分区，让消费者按指标名称聚合。进一步扩展时，可按标签继续分区，并对指标分类、设定采集优先级。

<div style="margin-left:3rem">
    <img src="./images/metrics-collection-kafka.png" alt="使用 Kafka 采集指标" width="500" />
</div>

使用 Kafka 的主要缺点是维护和运维开销。替代方案是 [Gorilla](https://www.vldb.org/pvldb/vol8/p1816-teller.pdf) 之类的大规模摄取系统，其可扩展性可能与 Kafka 队列相当。

### **在何处聚合**
指标可以在多个位置聚合，各有取舍：
 - **采集代理**：客户端代理只适合简单聚合，例如累计 1 分钟计数后发送。
 - **摄取流水线**：写库前用 Flink 等流处理引擎聚合，可减少写入量，但不保存原始数据，会损失精度。
 - **查询侧**：可视化系统查询时再聚合，数据无损，但处理大量数据可能使查询变慢。

### **查询服务**
独立查询服务可将可视化、告警系统与时间序列数据库解耦，让数据库可以独立更换。

还可添加缓存层，减少数据库负载：

<div style="margin-left:3rem">
    <img src="./images/cache-layer-query-service.png" alt="查询服务缓存层" width="500" />
</div>

不过，多数可视化和告警系统都有强大的插件，可直接集成时间序列数据库，因此也可完全省略查询服务。若数据库选择得当，自建缓存层可能也没有必要。

多数时间序列数据库不支持 SQL，因为 SQL 查询时间序列效率不高。下面是计算指数移动平均值的 SQL 示例：

```
select id,
       temp,
       avg(temp) over (partition by group_nr order by time_read) as rolling_avg
from (
  select id,
         temp,
         time_read,
         interval_group,
         id - row_number() over (partition by interval_group order by time_read) as group_nr
  from (
    select id,
    time_read,
    "epoch"::timestamp + "900 seconds"::interval * (extract(epoch from time_read)::int4 / 900) as interval_group,
    temp
    from readings
  ) t1
) t2
order by time_read;
```

同一查询用 InfluxDB 的 Flux 语言表示如下：

```
from(db:"telegraf")
  |> range(start:-1h)
  |> filter(fn: (r) => r._measurement == "foo")
  |> exponentialMovingAverage(size:-10s)
```

### **存储层**
时间序列数据库的选择很重要。

根据 Facebook 发表的研究，约 85% 的运维数据查询只涉及过去 26 小时的数据。

如果数据库能利用这一特点，就能显著改善性能；InfluxDB 是一个可选方案。

无论使用哪种数据库，还可采取一些优化。

数据编码和压缩能明显减少存储空间；好的时间序列数据库通常内建这些功能。

<div style="margin-left:3rem">
    <img src="./images/double-delta-encoding.png" alt="双重差分编码" width="500" />
</div>

上例中可存储时间戳差值，而非完整时间戳。

另一种方法是降采样：把高分辨率数据转换成低分辨率数据，以减少磁盘占用。

可对旧数据应用降采样，并让数据科学家配置规则，例如：
 - 7 天内：不降采样。
 - 30 天内：降采样到 1 分钟。
 - 1 年内：降采样到 1 小时。

例如，下表是 10 秒分辨率的指标：
| metric | timestamp            | hostname | Metric_value |
|--------|----------------------|----------|--------------|
| cpu    | 2021-10-24T19:00:00Z | host-a   | 10           |
| cpu    | 2021-10-24T19:00:10Z | host-a   | 16           |
| cpu    | 2021-10-24T19:00:20Z | host-a   | 20           |
| cpu    | 2021-10-24T19:00:30Z | host-a   | 30           |
| cpu    | 2021-10-24T19:00:40Z | host-a   | 20           |
| cpu    | 2021-10-24T19:00:50Z | host-a   | 30           |

降采样到 30 秒分辨率后：
| metric | timestamp            | hostname | Metric_value (avg) |
|--------|----------------------|----------|--------------------|
| cpu    | 2021-10-24T19:00:00Z | host-a   | 19                 |
| cpu    | 2021-10-24T19:00:30Z | host-a   | 25                 |

最后，对不常使用的旧数据还可使用成本更低的冷存储。

### **告警系统**

<div style="margin-left:3rem">
    <img src="./images/alerting-system.png" alt="告警系统" width="500" />
</div>

配置加载到缓存服务器。规则通常用 YAML 编写，例如：

```
- name: instance_down
  rules:

  # Alert for any instance that is unreachable for >5 minutes.
  - alert: instance_down
    expr: up == 0
    for: 5m
    labels:
      severity: page
```

告警管理器从缓存读取配置，并按规则定期调用查询服务。规则满足时，就创建告警事件。

告警管理器还负责：
 - 过滤、合并和去重。例如，同一实例多次触发相同告警，只生成一条事件。
 - 访问控制：只允许指定人员管理告警。
 - 重试：确保告警至少传播一次。

告警存储使用 Cassandra 等键值数据库保存所有告警的状态，确保通知至少发送一次。触发告警后，将其发布到 Kafka。

最后，告警消费者从 Kafka 拉取事件，通过电子邮件、短信、PagerDuty 或 Webhook 等渠道发出通知。

现实中有许多现成告警方案，自建系统通常很难证明值得。

### **可视化系统**
可视化系统展示一段时间内的指标和告警。下面是 Grafana 仪表盘示例：

<div style="margin-left:3rem">
    <img src="./images/grafana-dashboard.png" alt="Grafana 仪表盘" width="500" />
</div>

高质量可视化系统很难开发，通常有充分理由直接使用 Grafana 等现成方案。

---

## 第 4 步：总结
最终设计如下：

<div style="margin-left:3rem">
    <img src="./images/final-design.png" alt="最终设计" width="500" />
</div>
