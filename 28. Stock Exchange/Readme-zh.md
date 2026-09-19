# 第 28 章：证券交易所

## 简介
本章设计一个**电子证券交易所**。

其基本功能是高效地撮合买家与卖家。

主要交易所包括**纽约证券交易所（NYSE）**、**纳斯达克（NASDAQ）**等。

<div style="margin-left:3rem">
    <img src="./images/world-stock-exchanges.png" alt="全球证券交易所" width="500" />
</div>

---

## 第一步：理解问题并确定设计范围
 * 候选人：交易哪些证券？股票、期权还是期货？
 * 面试官：为简化问题，只交易股票。
 * 候选人：支持哪些订单操作——下单、撤单、改单？订单类型包括限价单、市价单和条件单吗？
 * 面试官：支持下单和撤单；订单类型只考虑限价单。
 * 候选人：需要支持盘后交易吗？
 * 面试官：不需要，只考虑正常交易时段。
 * 候选人：交易所的基本功能是什么？
 * 面试官：客户可以提交或取消限价单，实时收到撮合成交结果，并实时查看订单簿。
 * 候选人：交易所的规模如何？
 * 面试官：数万名用户同时交易，约 100 个交易标的，每天有数十亿笔订单。还需要合规风险检查。
 * 候选人：需要哪种风险检查？
 * 面试官：简单的检查即可，例如限制某用户每天最多交易 100 万股苹果公司股票。
 * 候选人：用户钱包如何参与？
 * 面试官：下单前要确认客户资金充足；待成交订单所需资金必须冻结，直到订单处理完毕。

### **非功能需求**
上述规模表明要设计的是中小型交易所，同时也应便于未来支持更多交易标的和用户。

其他非功能需求：
 * **可用性：**至少 99.99%；停机可能损害声誉。
 * **容错性：**需要容错与快速恢复机制，限制生产事故的影响。
 * **延迟：**往返延迟应达到毫秒级，重点关注第 99 百分位延迟。其长期偏高会损害部分用户体验。
 * **安全性：**提供账户管理，并通过 KYC 验证用户身份以满足法律要求；对公开资源实施 DDoS 防护。

### **粗略估算**
 * 100 个交易标的，每天 10 亿笔订单。
 * 正常交易时段为 09:30 至 16:00，共 6.5 小时。
 * QPS = 10 亿 / 6.5 / 3600 ≈ 43,000。
 * 峰值 QPS = 5 × QPS ≈ 215,000。
 * 开市时的交易量明显更高。

---

## 第二步：提出概要设计并达成共识

### **交易基础知识**
先介绍与交易所相关的基本概念。

经纪商在交易所与终端用户之间提供中介服务，例如 Robinhood、Fidelity。

机构客户使用专用交易软件进行大额交易，需要特殊处理。例如，将大额订单拆分，以免冲击市场。

订单类型：
 * **限价单：**指定固定价格买入或卖出；可能不能立即成交，也可能部分成交。
 * **市价单：**不指定价格，按当前市场价格立即执行。

价格：
 * **买价（Bid）：**买家愿意买入股票的最高价格。
 * **卖价（Ask）：**卖家愿意卖出股票的最低价格。

美国市场的行情报价分为 L1、L2、L3 三个层级。

L1 行情包括最优买卖价及相应数量：

<div style="margin-left:3rem">
    <img src="./images/l1-price.png" alt="L1 行情" width="500" />
</div>

L2 展示更多价格档位：

<div style="margin-left:3rem">
    <img src="./images/l2-price.png" alt="L2 行情" width="500" />
</div>

L3 展示各档价格及该档位排队的数量：

<div style="margin-left:3rem">
    <img src="./images/l3-price.png" alt="L3 行情" width="500" />
</div>

K 线展示指定时间区间内的开盘价、收盘价、最高价和最低价：

<div style="margin-left:3rem">
    <img src="./images/candlestick.png" alt="K 线" width="500" />
</div>

FIX 是多数供应商使用的证券交易信息交换协议。以下是一条交易消息示例：
```
8=FIX.4.2 | 9=176 | 35=8 | 49=PHLX | 56=PERS | 52=20071123-05:30:00.000 | 11=ATOMNOCCC9990900 | 20=3 | 150=E | 39=E | 55=MSFT | 167=CS | 54=1 | 38=15 | 40=2 | 44=15 | 58=PHLX EQUITY TESTING | 59=0 | 47=C | 32=0 | 31=0 | 151=15 | 14=0 | 6=0 | 10=128 |
```

### **概要设计**

<div style="margin-left:3rem">
    <img src="./images/high-level-design.png" alt="概要设计" width="500" />
</div>

交易流程：
 * 客户通过交易界面下单。
 * 经纪商将订单发送给交易所。
 * 订单经客户端网关进入交易所；网关进行验证、限流、身份认证等，再转发给订单管理器。
 * 订单管理器根据风险管理器设定的规则进行风险检查。
 * 通过风险检查后，订单管理器确认钱包中有足够资金。
 * 订单送至撮合引擎。撮合成功后，引擎分别为买卖双方产生一条执行记录（成交回报，fill）。订单按顺序处理，确保结果确定。
 * 执行结果返回客户。

市场数据流程（M1–M3）：
 * 撮合引擎产生执行结果流，发送给市场数据发布器。
 * 发布器构建 K 线图，并将其发送给数据服务。
 * 市场数据保存在支持实时分析的专用存储中；经纪商连接数据服务以获取及时行情。

报表流程（R1–R2）：
 * 报表服务从订单和执行记录中收集所需字段并写入数据库。
 * 报表字段包括 `client_id`、价格、数量、订单类型、成交数量和剩余数量。

交易流程位于关键路径，其他流程则不在关键路径上，因此它们的延迟要求不同。

#### 交易流程
交易流程位于关键路径，必须为低延迟充分优化。

核心是撮合引擎（也称交叉撮合引擎），主要负责：
 * 维护每个交易标的的订单簿，即该标的买卖订单的列表。
 * 撮合买卖订单；每次撮合分别为买方和卖方产生一条执行记录。该操作必须快速且准确。
 * 将执行结果流分发为市场数据。
 * 按确定的顺序产生撮合结果，为高可用性奠定基础。

接下来是序列器。它为每个入站订单和出站成交回报标记序列 ID，使撮合引擎具有确定性。

<div style="margin-left:3rem">
    <img src="./images/sequencer.png" alt="序列器" width="500" />
</div>

为订单与成交回报编号的原因：
 * 保证及时性与公平性；
 * 支持快速恢复与重放；
 * 提供恰好一次处理保证。

概念上可使用 Kafka 作为序列器，因为它相当于入站与出站消息队列；但为了降低延迟，这里自行实现。

订单管理器维护订单状态，并与撮合引擎交互：发送订单、接收成交回报。

订单管理器的职责：
 * 将订单送去进行风险检查，例如确认用户交易量小于 100 万股。
 * 检查用户钱包是否有足够资金执行订单。
 * 将订单送入序列器，再交给撮合引擎；只传递撮合必需的信息，以减少带宽使用。
 * 从序列器接收执行结果，再经客户端网关发送给经纪商。

实现订单管理器的主要挑战是状态转换管理。事件溯源是可行方案之一，下文会详细讨论。

最后，客户端网关接收用户订单并发送给订单管理器。其职责如下：

<div style="margin-left:3rem">
    <img src="./images/client-gateway.png" alt="客户端网关" width="500" />
</div>

由于客户端网关在关键路径上，应保持轻量。

不同客户可使用不同的客户端网关。例如，托管交易服务器是经纪商租用、部署在交易所数据中心的交易引擎服务器：

<div style="margin-left:3rem">
    <img src="./images/client-gateways.png" alt="客户端网关部署" width="500" />
</div>

#### 市场数据流程
市场数据发布器从撮合引擎接收执行结果流，并据此重建订单簿和 K 线图。

数据随后发送给数据服务，由它向订阅者展示聚合结果：

<div style="margin-left:3rem">
    <img src="./images/market-data.png" alt="市场数据" width="500" />
</div>

#### 报表流程
报表服务不在关键路径上，但仍是重要组件。

<div style="margin-left:3rem">
    <img src="./images/reporting-flow.png" alt="报表流程" width="500" />
</div>

它负责交易历史、税务报告、合规报告和结算等。报表流程对延迟的要求较低，更看重准确性与合规性。

### **API 设计**
客户通过经纪商与交易所交互，完成下单、查看成交记录和市场数据、下载历史数据进行分析等操作。

客户端网关与经纪商之间使用 RESTful API 通信。

机构客户则使用专有协议，以满足低延迟需求。

创建订单：
```
POST /v1/order
```

参数：
 * `symbol`：股票代码，字符串。
 * `side`：买入或卖出，字符串。
 * `price`：限价单价格，长整数。
 * `orderType`：限价单或市价单（本设计只支持限价单），字符串。
 * `quantity`：订单数量，长整数。

响应：
 * `id`：订单 ID，长整数。
 * `creationTime`：系统创建订单的时间，长整数。
 * `filledQuantity`：已成交数量，长整数。
 * `remainingQuantity`：待成交数量，长整数。
 * `status`：新建、已取消或已完全成交，字符串。
 * 其他属性与请求参数相同。

获取执行记录：
```
GET /execution?symbol={:symbol}&orderId={:orderId}&startTime={:startTime}&endTime={:endTime}
```

参数：
 * `symbol`：股票代码，字符串。
 * `orderId`：订单 ID，可选，字符串。
 * `startTime`：查询开始时间，纪元时间 \[11\]，长整数。
 * `endTime`：查询结束时间，纪元时间，长整数。

响应：
 * `executions`：查询范围内执行记录的数组（属性见下）。
 * `id`：执行记录 ID，长整数。
 * `orderId`：订单 ID，长整数。
 * `symbol`：股票代码，字符串。
 * `side`：买入或卖出，字符串。
 * `price`：成交价格，长整数。
 * `orderType`：限价单或市价单，字符串。
 * `quantity`：成交数量，长整数。

获取订单簿：
```
GET /marketdata/orderBook/L2?symbol={:symbol}&depth={:depth}
```

参数：
 * `symbol`：股票代码，字符串。
 * `depth`：每侧订单簿的深度，整数。

响应：
 * `bids`：包含价格和数量的买盘数组。
 * `asks`：包含价格和数量的卖盘数组。

获取 K 线：
```
GET /marketdata/candles?symbol={:symbol}&resolution={:resolution}&startTime={:startTime}&endTime={:endTime}
```

参数：
 * `symbol`：股票代码，字符串。
 * `resolution`：K 线时间窗口长度，单位为秒，长整数。
 * `startTime`：窗口开始的纪元时间，长整数。
 * `endTime`：窗口结束的纪元时间，长整数。

响应：
 * `candles`：K 线数据数组（每条记录的属性见下）。
 * `open`：开盘价，双精度浮点数。
 * `close`：收盘价，双精度浮点数。
 * `high`：最高价，双精度浮点数。
 * `low`：最低价，双精度浮点数。

### **数据模型**
交易所主要有三类数据：
 * 产品、订单和执行记录；
 * 订单簿；
 * K 线图。

#### 产品、订单和执行记录
产品描述交易标的属性，例如产品类型、交易代码和界面显示代码。

这类数据变化不频繁，主要用于界面展示。

订单代表买卖指令，执行记录代表撮合后输出的结果。

数据模型如下：

<div style="margin-left:3rem">
    <img src="./images/product-order-execution-data-model.png" alt="产品、订单和执行记录数据模型" width="500" />
</div>

三个流程都会使用订单和执行记录：
 * 在关键路径中，它们在内存中处理以获得高性能，并由序列器保存及恢复。
 * 报表服务将它们写入数据库，用于生成报告。
 * 执行记录传给市场数据服务，用于重建订单簿和 K 线图。

#### 订单簿
订单簿是某个交易标的的买卖订单列表，按价格档位组织。

高效的数据结构需要满足：
 * 常数时间查找，例如查询某价格档位或档位区间的成交量；
 * 快速新增、执行与取消订单；
 * 查询最优买价和卖价；
 * 遍历价格档位。

订单簿撮合示例：

<div style="margin-left:3rem">
    <img src="./images/order-book-execution.png" alt="订单簿撮合" width="500" />
</div>

这笔大额订单成交后，买卖价差扩大，价格上涨。

订单簿实现伪代码：
```
class PriceLevel{
    private Price limitPrice;
    private long totalVolume;
    private List<Order> orders;
}

class Book<Side> {
    private Side side;
    private Map<Price, PriceLevel> limitMap;
}

class OrderBook {
    private Book<Buy> buyBook;
    private Book<Sell> sellBook;
    private PriceLevel bestBid;
    private PriceLevel bestOffer;
    private Map<OrderID, Order> orderMap;
}
```

可用双向链表替代普通列表，进一步提高效率：
 * 新订单加入链表尾部，时间复杂度为 O(1)。
 * 撮合时从链表头部删除订单，时间复杂度为 O(1)。
 * 撤单需要从订单簿中删除订单；利用 `orderMap` 可在 O(1) 时间找到订单，而 `Order` 持有前驱节点引用，也可在 O(1) 时间删除。

<div style="margin-left:3rem">
    <img src="./images/order-book-impl.png" alt="订单簿实现" width="500" />
</div>

市场数据服务也使用该数据结构重建订单簿。

#### K 线图
市场数据服务根据一个时间区间内的订单处理结果计算 K 线：
```
class Candlestick {
    private long openPrice;
    private long closePrice;
    private long highPrice;
    private long lowPrice;
    private long volume;
    private long timestamp;
    private int interval;
}

class CandlestickChart {
    private LinkedList<Candlestick> sticks;
}
```

为避免内存占用过高，可采用：
 * 预分配环形缓冲区保存 K 线，减少内存分配次数。
 * 限制内存中的 K 线数量，将其余数据持久化到磁盘。

使用内存列式数据库（如 KDB）进行实时分析；收市后将数据保存到历史数据库。

---

## 第三步：详细设计
现代交易所与多数软件系统不同，有些会将几乎所有组件运行在一台大型服务器上。

下面分析其中的细节。

### **性能**
交易所需要在所有延迟百分位上都保持良好表现。

降低延迟的方法：
 * 减少关键路径上的任务数量。
 * 减少每项任务的耗时，包括减少网络和磁盘使用，或缩短任务执行时间。

为实现第一点，关键路径上移除所有非必要职责；甚至连日志记录也移除，以达到最佳延迟。

若沿用初始设计，服务间网络延迟以及序列器磁盘访问都会成为瓶颈。

初始设计的端到端延迟可达数十毫秒，但目标是数十微秒。

因此将组件放在同一台服务器上，并使用 `mmap` 作为事件存储，让各进程通信：

<div style="margin-left:3rem">
    <img src="./images/mmap-bus.png" alt="mmap 事件总线" width="500" />
</div>

另一项优化是使用应用循环，即持续执行关键任务的 `while` 循环，并将其固定在同一个 CPU 上，避免上下文切换：

<div style="margin-left:3rem">
    <img src="./images/application-loop.png" alt="应用循环" width="500" />
</div>

应用循环还能避免多个线程争夺相同资源造成的锁竞争。

`mmap` 是 UNIX 系统调用，可把磁盘文件映射到应用内存。

一种技巧是在代表共享内存的 `/dev/shm` 中创建文件，这样就完全不需要磁盘访问。

### **事件溯源**
事件溯源已在[数字钱包一章](../27.%20%20Digital%20Wallet/Readme-zh.md)详细讨论，可参阅该章了解完整背景。

简言之，系统保存不可变的状态转换，而不是仅保存当前状态：

<div style="margin-left:3rem">
    <img src="./images/event-sourcing.png" alt="事件溯源" width="500" />
</div>

 * 左侧是传统模式。
 * 右侧是事件溯源模式。

目前设计如下：

<div style="margin-left:3rem">
    <img src="./images/design-so-far.png" alt="当前设计" width="500" />
</div>

 * 外部系统通过 FIX 协议与客户端网关交互。
 * 订单管理器收到新订单事件后进行验证，并加入内部状态，再将订单送到撮合核心。
 * 若订单成交，就生成 `OrderFilledEvent`，并通过 `mmap` 发送。
 * 其他组件订阅事件存储，分别完成各自的处理。

另一项优化是：所有组件都持有以库形式打包的订单管理器副本，减少订单管理相关的额外调用。

在这一设计中，序列器不再充当事件存储，而是作为单写入者，在将事件转发到事件存储前为其编序：

<div style="margin-left:3rem">
    <img src="./images/sequencer-deep-dive.png" alt="序列器详解" width="500" />
</div>

### **高可用性**
目标可用性为 99.99%，相当于每天最多停机 8.64 秒。

为达到目标，需要找出架构中的单点故障：
 * 为撮合引擎等关键服务配置处于待命状态的备用实例。
 * 尽量自动化故障检测与向备用实例的切换。

客户端网关等无状态服务可通过增加服务器轻松水平扩容。

对于有状态组件，非领导者副本可以处理入站事件，但不发布出站事件：

<div style="margin-left:3rem">
    <img src="./images/leader-election.png" alt="领导者选举" width="500" />
</div>

可发送心跳检测主副本是否停止工作。

这种机制只在单台服务器内部有效。若要扩展到服务器级别，可配置整台服务器作为热备或温备，在故障时切换。

为跨副本复制事件存储，可使用可靠 UDP 加快通信。

### **容错性**
如果温备实例也故障怎么办？虽然概率较低，仍须有所准备。

大型科技公司会把核心数据复制到多个城市的数据中心，以减轻自然灾害等影响。

需要考虑：
 * 主实例故障后，何时以及如何切换到备用实例？
 * 如何从备用实例中选出领导者？
 * 所需的恢复时间是多少（RTO，恢复时间目标）？
 * 哪些功能必须恢复？系统能否降级运行？

应对方法：
 * Bug 可能同时影响主实例和副本；可通过混沌工程暴露此类边界情况与严重后果。
 * 在充分了解系统故障模式之前，初期可手动执行故障切换。
 * 主实例故障时可用领导者选举（如 Raft）确定接任副本。

跨服务器复制示例：

<div style="margin-left:3rem">
    <img src="./images/replication-across-servers.png" alt="跨服务器复制" width="500" />
</div>

领导者选举任期示例：

<div style="margin-left:3rem">
    <img src="./images/leader-election-terms.png" alt="领导者选举任期" width="500" />
</div>

有关 Raft 工作原理的细节，可[参阅此文](https://thesecretlivesofdata.com/raft/)。

最后，还要考虑数据丢失容忍度：在造成严重后果之前，最多能丢失多少数据？答案决定备份频率。

证券交易所不能接受数据丢失，因此必须频繁备份，并依靠 Raft 复制降低丢失概率。

### **撮合算法**
以下伪代码简要展示撮合过程：
```
Context handleOrder(OrderBook orderBook, OrderEvent orderEvent) {
    if (orderEvent.getSequenceId() != nextSequence) {
        return Error(OUT_OF_ORDER, nextSequence);
    }

    if (!validateOrder(symbol, price, quantity)) {
        return ERROR(INVALID_ORDER, orderEvent);
    }

    Order order = createOrderFromEvent(orderEvent);
    switch (msgType):
        case NEW:
            return handleNew(orderBook, order);
        case CANCEL:
            return handleCancel(orderBook, order);
        default:
            return ERROR(INVALID_MSG_TYPE, msgType);

}

Context handleNew(OrderBook orderBook, Order order) {
    if (BUY.equals(order.side)) {
        return match(orderBook.sellBook, order);
    } else {
        return match(orderBook.buyBook, order);
    }
}

Context handleCancel(OrderBook orderBook, Order order) {
    if (!orderBook.orderMap.contains(order.orderId)) {
        return ERROR(CANNOT_CANCEL_ALREADY_MATCHED, order);
    }

    removeOrder(order);
    setOrderStatus(order, CANCELED);
    return SUCCESS(CANCEL_SUCCESS, order);
}

Context match(OrderBook book, Order order) {
    Quantity leavesQuantity = order.quantity - order.matchedQuantity;
    Iterator<Order> limitIter = book.limitMap.get(order.price).orders;
    while (limitIter.hasNext() && leavesQuantity > 0) {
        Quantity matched = min(limitIter.next.quantity, order.quantity);
        order.matchedQuantity += matched;
        leavesQuantity = order.quantity - order.matchedQuantity;
        remove(limitIter.next);
        generateMatchedFill();
    }
    return SUCCESS(MATCH_SUCCESS, order);
}
```

该撮合算法采用 FIFO 原则，确定同一价格档位上的订单成交顺序。

### **确定性**
前述序列器技术保证功能上的确定性。

事件实际发生的时间并不影响结果：

<div style="margin-left:3rem">
    <img src="./images/determinism.png" alt="确定性" width="500" />
</div>

延迟的确定性也需监控，可通过第 99 或第 99.99 百分位延迟衡量。

例如，Java 垃圾回收事件可能引起延迟尖峰。

### **市场数据发布器优化**
市场数据发布器接收撮合引擎的成交结果，并据此重建订单簿和 K 线图。

内存有限，因此只保留部分 K 线。客户可选择所需数据的粒度；更精细的数据可能需要支付更高费用：

<div style="margin-left:3rem">
    <img src="./images/market-data-publisher.png" alt="市场数据发布器" width="500" />
</div>

环形缓冲区是首尾相接的固定大小队列。预分配空间可避免运行时分配，且该数据结构可实现无锁操作。

另一项优化是填充（padding），确保序列号不与其他数据共用缓存行。

### **市场数据分发公平性与多播**
应确保订阅者同时收到数据；否则，先收到数据的一方会获得关键市场信息，并可能利用它操纵市场。

因此，可使用可靠 UDP 多播向订阅者发布数据。

互联网中的数据传输有三种方式：
 * **单播：**一个源到一个目的地。
 * **广播：**一个源到整个子网。
 * **多播：**一个源到不同子网中的一组主机。

理论上，多播能让所有订阅者同时收到数据。

但 UDP 本身不可靠，数据可能无法送达所有人；可以通过重传改进。

### **同地部署**
交易所允许经纪商将服务器部署在交易所所在的数据中心。

这能显著降低延迟，可视为高级服务。

### **网络安全**
交易所的部分服务面向互联网，因此 DDoS 是一项挑战。可采取：
 * 隔离公开服务和数据与私有服务，避免 DDoS 攻击影响最重要的客户。
 * 用缓存层保存不经常更新的数据。
 * 设计更易缓存的 URL 以增强 DDoS 防护，例如优先使用 `https://my.website.com/data/recent`，而非 `https://my.website.com/data?from=123&to=456`。
 * 建立有效的允许名单和阻止名单机制。
 * 使用限流减轻 DDoS 攻击影响。

---

## 第四步：总结
其他值得注意的点：
 * 并非所有交易所都把所有组件放在一台大型服务器上，但仍有一些这样做。
 * 现代交易所越来越多地使用云基础设施，也使用自动做市商（AMM）以免维护订单簿。
