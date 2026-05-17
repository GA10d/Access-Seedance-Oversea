# Ark Video Studio

一个本地运行的火山方舟 Seedance 视频生成工作台。

## 使用

### 一键启动

双击项目根目录下的 `ArkVideoStudio.exe`，它会自动启动本地服务并打开浏览器。

如果提示找不到 Node.js，请先安装 Node.js 18 或更新版本。

### 命令行启动

1. 在 `.env` 中配置：

   ```text
   ARK_API_KEY=你的火山方舟 API Key
   # 可选但推荐：用于自动托管本地参考视频到 TOS
   TOS_ACCESS_KEY=你的火山引擎 AccessKey
   TOS_SECRET_KEY=你的火山引擎 SecretKey
   TOS_BUCKET=你的 TOS 桶名
   TOS_REGION=cn-beijing
   TOS_ENDPOINT=tos-cn-beijing.volces.com
   TOS_PREFIX=ark-video-studio/reference-videos
   TOS_CLEANUP_HOURS=24
   TOS_SIGNED_URL_EXPIRES_SECONDS=86400
   # 可选：用于费用中心余额查询。ARK_API_KEY 不能查询账务余额。
   # VOLC_BILLING_BASIC_TOKEN=费用中心 QueryBalanceAcct 文档中的 Basic token
   ```

2. 启动：

   ```bash
   npm start
   ```

3. 打开：

   ```text
   http://127.0.0.1:5173
   ```

## 能力

- 通过 `/api/v3/models` 获取模型列表，自动筛选 `seed|video|dance|doubao` 相关模型，并把较新的 Seedance 模型排在前面。
- 配置分辨率、比例、时长、帧数、seed、服务等级、声音、水印、尾帧、联网搜索等参数。
- 上传参考图片，或添加图片公网 URL、`asset://` 素材 ID；配置 TOS 后，本地参考视频会自动上传到 TOS 并转成临时 http(s) URL。
- prompt 中支持点击素材标签插入 `@图片1`、`@视频1`。
- 提交异步视频生成任务，轮询状态，成功后预览并通过本地代理下载视频。
- 生成结果可一键加入参考素材：视频作为 `@视频N`，尾帧作为 `@图片N`。
- 显示费用信息：提交前对 Seedance 2.0 做粗略估算，完成后按任务返回的 `usage` token 做费用估算；配置费用中心 Basic 授权后可显示可用余额。

## 说明

官方创建任务接口支持图片 Base64、图片 URL、素材 ID；`reference_video` 当前必须提供公网可访问的 http(s) URL。App 会在配置 TOS 后自动上传本地参考视频，并在任务成功/失败/过期/取消后删除对象；未进入任务的对象会按 `TOS_CLEANUP_HOURS` 兜底清理。

费用估算不是账单，实际扣费以火山引擎费用中心为准。余额查询使用费用中心 `QueryBalanceAcct`，需要单独的费用中心授权。
