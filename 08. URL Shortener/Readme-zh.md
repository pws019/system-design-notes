# 第 8 章：设计短链接服务

## 简介
本章讨论类似 TinyURL 的短链接服务。主要目标是**缩短 URL**、**重定向**，并具备处理大量流量的**高扩展性**。

### 需求
- 短链接必须**唯一**且**尽可能短**。
- 每天生成 **1 亿个 URL**，支持持续运行 10 年。
- 读写比为 10:1，读取操作需高效。
- 10 年存储 3650 亿条记录，约需 **365 TB** 空间。

---

## 第一步：概要设计

### API 接口
1. **缩短 URL：**
   - 接口：`POST api/v1/data/shorten`
   - 参数：`{longUrl: longURLString}`
   - 返回：`shortURL`

2. **URL 重定向：**
   - 接口：`GET api/v1/shortUrl`
   - 返回用于重定向的 `longURL`。

    <p align="center">
    <img src="./images/url-redirection.png" alt="URL 重定向" width="600">
    </p>

### URL 重定向
- **301 重定向：**表示请求的 URL 已永久迁移到长 URL。浏览器会缓存响应，后续访问同一短链接不再请求短链接服务。
- **302 重定向：**表示临时迁移，适合统计点击等分析场景。

### 缩短 URL
<p align="center">
    <img src="./images/url-shortening.png" alt="缩短 URL" width="400">
</p>

- 使用**哈希函数**生成短链接，将长 URL 映射为唯一的短链接。
- 哈希函数应满足：
    - 每个 `longURL` 对应一个 `hashValue`。
    - 每个 `hashValue` 都能映射回 `longURL`。

---

## 第二步：详细设计

### 数据模型
在关系型数据库中存储 `<shortURL, longURL>` 映射，以节省内存。表包含：
- `id`（主键）；
- `shortURL`；
- `longURL`。

    <img src="./images/table-schema.png" alt="表结构" width="300">

### 哈希函数
#### 1. Base 62 编码
- 使用 `[0-9, a-z, A-Z]` 编码数字，共有 **62 个字符**。
- 进制转换是短链接服务常用的另一种方案。
- 给短链接分配唯一 ID，再将 ID 转换为 Base 62，即可得到短链接。
- 7 位编码最多支持约 **3.5 万亿个唯一 URL**，足以覆盖 3650 亿个 URL。

**示例：**将 ID `2009215674938` 转换为 Base 62：
- `2009215674938` → `zn9edcu`。

#### 2. 哈希与冲突处理
- 可使用 CRC32、MD5 或 SHA-1 等哈希函数。

    <img src="./images/hash-function.png" alt="哈希函数" width="500">

- 一种做法是截取哈希值前 7 个字符，但可能发生冲突。
- 遇到冲突时，可反复附加预设字符串并重新计算，直到不再冲突，但代价较高。
- 可借助**布隆过滤器**高效判断短链接是否已存在。

    <p align="center">
    <img src="./images/url-lookup.png" alt="URL 查找" width="500">
    </p>

### 方案比较

- **哈希与冲突处理：**
    - 短链接长度固定；
    - 无需唯一 ID 生成器；
    - 可能发生冲突，必须处理；
    - 不依赖 ID，无法直接推算下一个可用短链接。

- **Base 62 编码：**
    - 长度不固定，会随 ID 增长；
    - 需要唯一 ID 生成器；
    - 不会发生编码冲突；
    - 若 ID 每次加 1，下一个短链接容易推算，可能带来安全风险。

---

### 短链接生成流程

<p align="center">
    <img src="./images/url-shortening-flow.png" alt="短链接生成" width="500">
</p>

1. 查询数据库中是否已有 `longURL`。
2. 如果存在，返回已有的 `shortURL`。
3. 否则：
   - 使用**分布式 ID 生成器**生成唯一 ID；
   - 将 ID 转换为 Base 62，得到 `shortURL`；
   - 在数据库中保存 `<id, shortURL, longURL>` 映射。

---

### URL 重定向流程
<p align="center">
    <img src="./images/url-redirecting-flow.png" alt="URL 重定向" width="600">
</p>

1. 用户点击 `shortURL`。
2. 查询 `<shortURL, longURL>` 映射：
   - 优先查**缓存**，降低访问延迟；
   - 缓存未命中时查询数据库。
3. 将用户重定向到 `longURL`。

---

## 其他考虑
### 限流
- 按 IP 限制请求次数，防止滥用。

### 扩展性
1. **Web 层：**保持无状态，通过增减服务器扩容或缩容。
2. **数据库层：**使用复制和分片。

### 数据分析
- 收集点击率、来源和时间戳等数据，为业务分析提供依据。

### 高可用性与可靠性
- 通过数据库复制及容错设计，维持服务的一致性与可靠性。
