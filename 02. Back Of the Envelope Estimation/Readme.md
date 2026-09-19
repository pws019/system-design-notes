# Chapter 2: Back-of-the-Envelope Estimation

## Introduction
Back-of-the-envelope estimation is a crucial skill in system design interviews. It involves making quick, rough calculations to assess system capacity or performance. According to Jeff Dean, Google Senior Fellow, these estimates help evaluate whether designs meet requirements through thought experiments and common performance benchmarks.

This chapter covers key concepts, methodologies, and examples to build proficiency in scalability and estimation.

---

## Section 1: Key Concepts

### Power of Two
Understanding data volume in terms of powers of two is fundamental:

<img src="./images/power-of-two.png" alt="power-of-two" width="500" />

This knowledge helps in performing accurate storage and bandwidth calculations.

---

### Latency Numbers Every Programmer Should Know
Latency numbers represent the time taken for various operations in computing systems. These provide insights into relative performance:

| Operation                | Latency (2020) |
|--------------------------|----------------|
| L1 Cache Access          | 0.5 ns         |
| L2 Cache Access          | 7 ns           |
| Main Memory Access       | 100 ns         |
| SSD Random Read          | 150 µs         |
| HDD Random Seek          | 10 ms          |
| Round-Trip in Data Center| 500 µs         |
| Inter-Region Data Center | 150 ms         |

**Key Insights:**
- Memory is fast, disk is slow.
- Avoid disk seeks whenever possible.
- Compress data before transmitting over the internet to save bandwidth.


---

### Availability Numbers
High availability (HA) ensures minimal downtime. Availability is expressed in **nines**:
- **99% (Two Nines):** ~3.65 days/year of downtime
- **99.9% (Three Nines):** ~8.8 hours/year of downtime
- **99.99% (Four Nines):** ~52 minutes/year of downtime
- **99.999% (Five Nines):** ~5.3 minutes/year of downtime
- **99.9999% (Six Nines):** ~31.56 seconds/year of downtime


Cloud providers like Amazon, Google, and Microsoft aim for SLAs (Service Level Agreements) of **99.9% or higher**.

---

## Section 2: Example Estimation - Twitter QPS and Storage Requirements

### Assumptions
- **300 million monthly active users (MAU).**
- **50% daily active users (DAU).**
- **Average tweets/user/day:** 2.
- **10% of tweets contain media.**
- **Data retention:** 5 years.

### Estimations
1. **Query Per Second (QPS):**
   - DAU = \( 300M x 50\% = 150M \)
   - Tweets QPS = \( 150M x 2 tweets / 24 hour / 3600 seconds = ~3500 )
   - Peak QPS = \( 2 x 3500 = ~7000 \)

2. **Media Storage:**
   - **Tweet Size Components:**
     - `tweet_id`: 64 bytes
     - `text`: 140 bytes
     - `media`: 1 MB
   - **Daily Media Storage:** \( 150M x 2 x 10\% x 1MB = 30TB per day \)
   - **5-Year Storage:** \( 30TB x 365 x 5 = ~55PB \)

3. **Cache Requirements** (extending the same assumptions):
   - **Extra assumption:** each DAU reads 100 tweets/day, and the Pareto rule applies (20% of tweets serve 80% of reads).
   - **Daily reads:** \( 150M x 100 = 15B \) tweet reads per day
   - **Read QPS:** \( 15B / 86400 = ~175,000 \); Peak read QPS = \( 2 x 175,000 = ~350,000 \)
   - **Text size per tweet:** `tweet_id` + `text` = 64 + 140 = ~200 bytes (media is served from a CDN, not cached here)
   - **Data read per day:** \( 15B x 200B = 3TB \)
   - **Cache only the hot 20%:** \( 3TB x 20\% = ~600GB \)
   - **Machines:** with ~64GB of usable memory per cache node, \( 600GB / 64GB = ~10 \) nodes; round up to ~12 to leave headroom and replicas for hot keys.

4. **Number of Servers:**
   - **Peak load:** \( 350,000 (read) + 7,000 (write) = ~350,000 QPS \)
   - **Assumed per-server capacity:** ~5,000 QPS (a 16-core app server doing lightweight work; benchmark in practice)
   - **Servers needed:** \( 350,000 / 5,000 = 70 \)
   - **Headroom (~30%) for failures and deploys:** \( 70 x 1.3 = ~90 \) servers
   - **Sanity check:** a cache hit (~100 ns memory read) keeps per-request latency low; if the hit rate dropped, requests would fall to the database and the per-server QPS assumption would no longer hold.

---

## Section 3: Tips for Effective Estimation

### 1. Rounding and Approximation
Precision is not critical; focus on the process. Simplify complex calculations using round numbers. For example:
- \( 99987 / 9.1 \) can be approximated as \( 100,000 / 10 = 10,000 \).

### 2. Write Down Assumptions
Document assumptions clearly for future reference.

### 3. Label Units
Avoid ambiguity by labeling units (e.g., `5 MB` instead of `5`).

### 4. Common Estimation Scenarios
- **QPS (Queries Per Second):** Measure traffic intensity.
- **Peak QPS:** Account for traffic spikes.
- **Storage Requirements:** Estimate total data needs.
- **Cache Requirements:** Evaluate memory requirements for caching.
- **Number of Servers:** Calculate hardware needs based on workload.

