# 更新记录

## V2606041615

- 从本地维护数据 `archive/working/` 生成最新版 `public-site/` 上线包。
- 当前上线包记录数 138，照片 100，视频 38。
- 当前上线包约 392M，包含 2 个超过 25MiB 的视频，因此第一版更适合 GitHub Pages；Cloudflare Pages 需要后续配合 R2。
- 未修改原始 `source-*` 快照。
- 回滚方式：重新运行旧版生成脚本或使用 `archive/manifests/source-*` 原始快照重新生成。

后续每次正式发布都应记录：

- 版本号
- 发布时间
- 改动内容
- 是否涉及资料内容
- 回滚方式
