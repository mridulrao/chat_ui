## Qwen 4B SLM Deployment and Inference API

This project focuses on deploying the **Qwen 4B Small Language Model (SLM)** using the vLLM framework, offering both streaming and non-streaming inference capabilities.
See python_chatbot direcory

### Features

* **Model Deployment:** Implementation for deploying the **Qwen 4B Instruct** model.
* **API Endpoints:** Provides robust endpoints for both **streaming** and **non-streaming** requests.
* **Agent Demo:** Includes a demonstration agent showcasing the **function calling/tool-use** capabilities of the Qwen 4B Instruct model, utilizing 4-5 defined functions.

---

### Performance Benchmarks

The following results were gathered by running **20 concurrent requests** against the deployed Qwen 4B model to measure latency and throughput under load.

#### Non-Streaming Endpoint Benchmark

This benchmark measures the full response time for 20 concurrent, non-streaming requests.

| Metric | Result |
| :--- | :--- |
| Successful requests | 20/20 |
| Avg latency | 13.337s |
| p50 latency | 13.768s |
| p90 latency | 14.091s |
| p95 latency | 14.107s |
| Total tokens | 5,356 |
| **Throughput (Aggregate)** | **379.62 tokens/sec** |

#### Streaming Endpoint Benchmark

This benchmark measures both the time-to-first-token (TTFT) and full latency for 20 concurrent streaming requests.

| Metric | Result |
| :--- | :--- |
| Successful requests | 20/20 |
| Avg latency | 15.735s |
| p50 latency | 16.508s |
| p90 latency | 16.846s |
| p95 latency | 16.852s |
| TTFT p50 | 1.147s |
| TTFT p90 | 1.319s |
| TTFT p95 | 1.333s |
| Total tokens | 5,310 |
| **Throughput (Aggregate)** | **312.98 tokens/sec** |


NOTE: ** JS is Vibe coded ** 

