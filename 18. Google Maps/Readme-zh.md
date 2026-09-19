# 第 18 章：Google Maps

## 引言

本章设计一个简化版 **Google Maps**。

关于 Google Maps 的一些事实：
 * 于 2005 年推出。
 * 提供卫星影像、街道地图、实时路况和路线规划等服务。
 * 到 2021 年，日活跃用户达 10 亿，覆盖全球 99% 的地区，每天更新 2500 万条实时位置信息。

---

## 第 1 步：理解问题并确定设计范围

候选人与面试官之间的示例问答：
 * 候选人：需要服务多少日活跃用户？
 * 面试官：10 亿。
 * 候选人：重点设计哪些功能？
 * 面试官：位置更新、导航、预计到达时间（ETA）和地图渲染。
 * 候选人：道路数据有多大？我们能拿到吗？
 * 面试官：已经从多个来源获得道路数据，原始数据量为 TB 级。
 * 候选人：需要考虑路况吗？
 * 面试官：需要，这样才能准确估算时间。
 * 候选人：步行、骑行、驾车等不同出行方式呢？
 * 面试官：都需要支持。
 * 候选人：需要规划多站点路线吗？
 * 面试官：本次面试暂不讨论。
 * 候选人：商家地点和照片呢？
 * 面试官：好问题，但也无需考虑。

我们重点讨论三个功能：用户位置更新、包含 ETA 的导航服务，以及地图渲染。

### **非功能需求**

- **准确性**：不能向用户提供错误路线。
- **导航流畅**：地图渲染应保持流畅。
- **数据流量与耗电量**：客户端应尽可能少消耗数据流量和电量，对移动设备尤其重要。
- 还需满足一般的可用性和可扩展性要求。

### **地图基础知识**

在开始设计前，先了解几个地图相关概念。

#### 定位系统

地球是绕轴旋转的球体。位置由纬度（南北方向）和经度（东西方向）定义：

<div style="margin-left:3rem">
    <img src="./images/partitioning-system.png" alt="定位系统" width="500" />
</div>

#### 从三维到二维

将三维空间中的点转换到二维平面的过程称为“地图投影”。

投影方法很多，各有利弊；几乎所有方法都会使实际几何形状变形。

<div style="margin-left:3rem">
    <img src="./images/map-projections.png" alt="地图投影" width="500" />
</div>

Google Maps 采用一种经过修改的墨卡托投影，称为“Web 墨卡托投影”。

#### 地理编码

地理编码是把地址转换为地理坐标的过程。

反向过程称为“逆地理编码”。

一种实现方法是插值：利用地理信息系统（GIS）等不同来源的数据，将道路网络映射到地理坐标空间。

#### Geohash

Geohash 是把地理区域编码为字母和数字字符串的系统。

它将世界视为展平的平面，递归地划分为四个象限：

<div style="margin-left:3rem">
    <img src="./images/geohashing.png" alt="Geohash" width="500" />
</div>

#### 地图渲染

地图通过瓦片渲染。世界被划分成许多小瓦片，而非作为一张巨大的自定义图片整体渲染。

客户端仅下载相关瓦片，再像拼贴画一样把它们组合起来。

不同缩放级别对应不同的瓦片。客户端根据当前缩放级别选取合适的瓦片。

例如，缩小到整个世界时，只需下载一张代表全球的 256×256 瓦片。

#### 为导航算法处理道路数据

在多数路线算法中，交叉路口表示为节点，道路表示为边：

<div style="margin-left:3rem">
    <img src="./images/road-representation.png" alt="道路表示" width="500" />
</div>

多数导航算法使用经过修改的 Dijkstra 算法或 A* 算法。

寻路性能对图的大小非常敏感。要达到目标规模，不能把整个世界建成一张图并直接在上面运行算法。

相反，我们使用类似瓦片的技术，将世界划分为更小的道路图。

路线瓦片保存相邻瓦片的引用；算法遍历相连瓦片时，可以拼接出更大的道路图：

<div style="margin-left:3rem">
    <img src="./images/routing-tiles.png" alt="路线瓦片" width="500" />
</div>

这样可以显著减少内存带宽消耗，只加载当前起点与终点所需的瓦片。

不过，对较长路线而言，拼接大量细粒度瓦片仍会耗费时间和内存。因此，路线瓦片采用不同的细节层级；算法根据目的地选择合适层级的瓦片：

<div style="margin-left:3rem">
    <img src="./images/map-routing-hierarchical.png" alt="分层路线瓦片" width="500" />
</div>

### **粗略估算**

需要存储：
 * 世界地图：考虑所有瓦片，并计入相似瓦片（例如大片沙漠）的压缩效果，估计约 70 PB。
 * 元数据：占用空间很小，可忽略不计。
 * 道路信息：以路线瓦片形式存储。

导航请求 QPS 估算：10 亿日活跃用户，每人每周使用 35 分钟，约等于每天总共 50 亿分钟。假设 GPS 更新请求经过批处理，平均约 20 万 QPS，峰值约 100 万 QPS。

---

## 第 2 步：提出概要设计并达成共识

<div style="margin-left:3rem">
    <img src="./images/high-level-design.png" alt="概要设计" width="500" />
</div>

### **位置服务**

<div style="margin-left:3rem">
    <img src="./images/location-service.png" alt="位置服务" width="500" />
</div>

它负责记录用户的位置更新：
 * 每隔 `t` 秒发送一次位置更新。
 * 位置数据流可用于持续改善服务，例如提供更准确的 ETA、监测路况、发现封闭道路和分析用户行为。

客户端可以先批量收集位置更新，再成批发送给服务器，而非每次更新都单独发送：

<div style="margin-left:3rem">
    <img src="./images/location-update-batches.png" alt="批量位置更新" width="500" />
</div>

即使有这一优化，Google Maps 规模的系统仍承受很大负载。因此，可以使用 Cassandra 等针对大量写入优化的数据库。

也可用 Kafka 高效处理位置更新数据流，供后续分析。

位置更新请求示例：

```
POST /v1/locations
Parameters
  locs: JSON encoded array of (latitude, longitude, timestamp) tuples.
```

### **导航服务**

该组件需要在合理时间内找出 A、B 两地之间的快速路线（允许少量延迟）。路线未必绝对最快，但准确性很重要。

请求示例：

```
GET /v1/nav?origin=1355+market+street,SF&destination=Disneyland
```

响应示例：

```json
{
  "distance": {"text":"0.2 mi", "value": 259},
  "duration": {"text": "1 min", "value": 83},
  "end_location": {"lat": 37.4038943, "Ing": -121.9410454},
  "html_instructions": "Head <b>northeast</b> on <b>Brandon St</b> toward <b>Lumin Way</b><div style=\"font-size:0.9em\">Restricted usage road</div>",
  "polyline": {"points": "_fhcFjbhgVuAwDsCal"},
  "start_location": {"lat": 37.4027165, "lng": -121.9435809},
  "geocoded_waypoints": [
    {
       "geocoder_status" : "OK",
       "partial_match" : true,
       "place_id" : "ChIJwZNMti1fawwRO2aVVVX2yKg",
       "types" : [ "locality", "political" ]
    },
    {
       "geocoder_status" : "OK",
       "partial_match" : true,
       "place_id" : "ChIJ3aPgQGtXawwRLYeiBMUi7bM",
       "types" : [ "locality", "political" ]
    }
  ],
  "travel_mode": "DRIVING"
}
```

上面的方案尚未考虑路况变化和重新规划路线，下文将深入讨论。

### **地图渲染**

地图瓦片的完整数据集达 PB 级，不可能全部保存在客户端。

客户端需要根据当前位置和缩放级别，按需从服务器获取瓦片。

用户缩放地图，或导航进入新的瓦片区域时，都需要获取新瓦片。

如何向客户端提供地图瓦片？
 * 可以动态生成，但服务器负载会很高，而且难以缓存。
 * 也可以基于客户端能计算的 Geohash 静态提供地图瓦片，将其保存在 CDN 并由 CDN 提供服务。

<div style="margin-left:3rem">
    <img src="./images/static-map-tiles.png" alt="静态地图瓦片" width="500" />
</div>

CDN 让用户从距离最近的接入点（POP）服务器获取地图瓦片，从而降低延迟：

<div style="margin-left:3rem">
    <img src="./images/cdn-vs-no-cdn.png" alt="使用 CDN 与不使用 CDN 的对比" width="500" />
</div>

确定地图瓦片有两种选择：
 * 客户端自行计算瓦片的 Geohash。但采用这种方式就要长期保持计算规则稳定，因为强制客户端升级很难。
 * 也可以提供简单 API，由服务器为客户端计算地图瓦片 URL，代价是增加一次 API 调用。

<div style="margin-left:3rem">
    <img src="./images/map-tile-url-calculation.png" alt="地图瓦片 URL 计算" width="500" />
</div>

---

## 第 3 步：深入设计

### **数据模型**

下面讨论不同类型数据的存储方式。

#### 路线瓦片

最初的道路数据来自不同来源，随后根据位置更新数据持续改善。

道路数据是非结构化的。周期性的离线处理流水线将原始数据转换成应用需要的图结构路线瓦片。

这里无需数据库特性，因此可把瓦片存入 S3 对象存储，并积极缓存。

也可以借助程序库，将邻接表高效压缩成二进制文件。

#### 用户位置数据

用户位置数据对更新路况以及其他分析工作很有价值。

这类数据写入量大，可用 Cassandra 存储。

示例记录：

<div style="margin-left:3rem">
    <img src="./images/user-location-data-torw.png" alt="用户位置数据记录" width="500" />
</div>

#### 地理编码数据库

该数据库存储经纬度对与地点之间的键值映射。

由于读取频繁、写入较少，可用读取速度快的 Redis。

#### 预先生成的世界地图图像

如前所述，预先生成地图瓦片图像，并将其存储在 CDN 上。

<div style="margin-left:3rem">
    <img src="./images/precomputed-map-tile-image.png" alt="预先生成的地图瓦片图像" width="500" />
</div>

### **服务**

#### 位置服务

下面详细讨论位置服务的数据库设计与用户位置存储。

<div style="margin-left:3rem">
    <img src="./images/location-service-diagram.png" alt="位置服务示意图" width="500" />
</div>

可以使用 NoSQL 数据库承担大量位置更新写入。用户位置经常变化，新更新到来后旧数据很快失效，因此优先保证可用性，而非强一致性。

Cassandra 符合这些需求，因此选用它作为数据库。

要存储的记录示例：

<div style="margin-left:3rem">
    <img src="./images/user-location-row-example.png" alt="用户位置记录示例" width="500" />
</div>

 * `user_id` 是分区键，方便快速访问某位用户的所有位置更新。
 * `timestamp` 是聚簇键，按收到位置更新的时间排序存储数据。

我们还通过 Kafka 将位置更新作为数据流发送给其他有不同用途的服务：

<div style="margin-left:3rem">
    <img src="./images/location-update-streaming.png" alt="位置更新数据流" width="500" />
</div>

#### 地图渲染

地图瓦片按多种缩放级别存储。在最低缩放级别，整个世界由一张 256×256 瓦片表示。

缩放级别每提高一级，地图瓦片数量变为原来的四倍：

<div style="margin-left:3rem">
    <img src="./images/zoom-level-increases.png" alt="缩放级别提高" width="500" />
</div>

一种优化是不通过网络传输完整图像，而是用矢量数据（路径和多边形）表示瓦片，由客户端动态渲染。

这样可以显著节省带宽。

#### 导航服务

该服务负责寻找最快路线：

<div style="margin-left:3rem">
    <img src="./images/navigation-service.png" alt="导航服务" width="500" />
</div>

下面逐个说明该子系统的组件。

首先，地理编码服务把地址解析为经纬度位置。

请求示例：

```
https://maps.googleapis.com/maps/api/geocode/json?address=1600+Amphitheatre+Parkway,+Mountain+View,+CA
```

响应示例：

```json
{
   "results" : [
      {
         "formatted_address" : "1600 Amphitheatre Parkway, Mountain View, CA 94043, USA",
         "geometry" : {
            "location" : {
               "lat" : 37.4224764,
               "lng" : -122.0842499
            },
            "location_type" : "ROOFTOP",
            "viewport" : {
               "northeast" : {
                  "lat" : 37.4238253802915,
                  "lng" : -122.0829009197085
               },
               "southwest" : {
                  "lat" : 37.4211274197085,
                  "lng" : -122.0855988802915
               }
            }
         },
         "place_id" : "ChIJ2eUgeAK6j4ARbn5u_wAGqWA",
         "plus_code": {
            "compound_code": "CWC8+W5 Mountain View, California, United States",
            "global_code": "849VCWC8+W5"
         },
         "types" : [ "street_address" ]
      }
   ],
   "status" : "OK"
}
```

路线规划服务根据当前路况，计算以通行时间为优化目标的建议路线。

最短路径服务针对对象存储中的路线瓦片运行 A* 算法的变体，计算最优路径：
 * 接收起点和终点，将其转换为经纬度，再计算对应的 Geohash，以找到所需路线瓦片。
 * 从起点瓦片开始遍历，直到找到通往终点瓦片的足够好的路径。

<div style="margin-left:3rem">
    <img src="./images/shortest-path-service.png" alt="最短路径服务" width="500" />
</div>

路线规划器调用 ETA 服务，后者借助机器学习算法，根据交通数据预测预计到达时间。

排序服务根据用户传入的筛选条件，对多条候选路线排序，例如避开收费道路或高速公路。

更新服务以异步方式更新重要数据库，保持数据新鲜。

#### 改进：自适应 ETA 与重新规划路线

可以根据最新路况动态更新正在使用的路线。

一种实现方法是在数据库中记录正在导航的用户，以及他们预计经过的所有瓦片。

数据可能如下：

```
user_1: r_1, r_2, r_3, …, r_k
user_2: r_4, r_6, r_9, …, r_n
user_3: r_2, r_8, r_9, …, r_m
...
user_n: r_2, r_10, r21, ..., r_l
```

如果某个瓦片区域发生交通事故，就能识别路线经过该瓦片的全部用户，并为他们重新规划路线。

为减少数据库中的瓦片数量，可以只存储起点路线瓦片，以及不同分辨率层级上的若干瓦片，直到其范围包含终点瓦片：

```
user_1, r_1, super(r_1), super(super(r_1)), ...
```

<div style="margin-left:3rem">
    <img src="./images/adaptive-eta-data-storage.png" alt="自适应 ETA 数据存储" width="500" />
</div>

采用这种方式，只需检查用户的最终瓦片是否包含事故瓦片，就能判断用户是否受影响。

也可以追踪导航用户的所有候选路线，当出现更快的替代路线时通知他们。

#### 数据推送协议

服务器主动向客户端推送数据有几种选择：
 * 移动推送通知不适合，因为载荷大小受限，而且 Web 应用无法使用。
 * WebSocket 通常比长轮询更合适，因为服务器计算开销较低。
 * 也可使用服务器发送事件（SSE），但 WebSocket 支持双向通信，对末端配送等功能可能有用，因此更倾向于 WebSocket。

---

## 第 4 步：总结

最终设计如下：

<div style="margin-left:3rem">
    <img src="./images/final-design.png" alt="最终设计" width="500" />
</div>

还可以增加多站点导航功能，提供给 Uber 或 Lyft 等企业客户，帮助他们确定访问一组地点的最优路线。
