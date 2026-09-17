resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.project_name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# CloudFront（このdistributionからのみ）にGetObjectを許可する。バケット自体は非公開のまま。
data "aws_iam_policy_document" "web_bucket" {
  statement {
    sid       = "AllowCloudFrontServicePrincipal"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket.json
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "${var.project_name} web"

  origin {
    origin_id                = "s3-web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  # app層が未apply（var.alb_dns_name空文字）のときは何も作らない。
  # just up がapp層apply後にこの値付きでedgeを再applyすると、
  # distributionの「更新」（作成/削除より速い）としてこのブロックが追加される。
  dynamic "origin" {
    for_each = var.alb_dns_name != "" ? [var.alb_dns_name] : []
    content {
      origin_id   = "alb-api"
      domain_name = origin.value

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "http-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }
    }
  }

  default_cache_behavior {
    target_origin_id       = "s3-web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id
  }

  dynamic "ordered_cache_behavior" {
    for_each = var.alb_dns_name != "" ? [var.alb_dns_name] : []
    content {
      path_pattern             = "/api/*"
      target_origin_id         = "alb-api"
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host_header.id
    }
  }

  # SPAはルーティングライブラリを使わない単一ページだが、
  # OAC配下のS3は存在しないオブジェクトに403を返す（404ではない）ため、
  # 両方をindex.htmlにフォールバックさせる。
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
