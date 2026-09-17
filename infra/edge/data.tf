data "aws_caller_identity" "current" {}

# マネージドポリシーのIDはハードコードせず名前引きする。
# CachingDisabled: /api/* をキャッシュしない。
# CachingOptimized: S3オリジン（SPA本体）はブラウザキャッシュに任せる標準設定。
# AllViewerExceptHostHeader: Authorization等のヘッダをALBへ素通しする
# （Hostヘッダだけ除外しないとALBがCloudFrontのドメイン名をHostとして受け取り混乱する）。
data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_origin_request_policy" "all_viewer_except_host_header" {
  name = "Managed-AllViewerExceptHostHeader"
}
