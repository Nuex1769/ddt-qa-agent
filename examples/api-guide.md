# 开放平台接入指南

> 虚构演示资料，适用 DDT 开放平台 v1.0。

## 如何接入流式问答

应用通过后端 POST /api/chat 发起请求，携带问题、可选的会话 ID、产品和版本筛选。接口使用 SSE 返回 status、conversation、sources、delta、done 和 error 事件。

## 如何处理流式事件

status 用于展示检索进度；conversation 返回会话 ID；sources 返回当前引用；delta 追加正文；done 表示成功结束；error 表示失败。客户端必须按 SSE 事件边界组装数据，不能假设一次网络分块就是一个完整事件。

## 密钥如何保存

模型 API 密钥只保存在后端环境变量，不能暴露到浏览器。前端通过 HttpOnly Cookie 认证。生产部署使用 HTTPS、强会话密钥和独立数据库。
