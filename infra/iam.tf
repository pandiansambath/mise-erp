# EC2 instance role: pull images from ECR (+ SSM for debugging shell, no key needed).
resource "aws_iam_role" "ec2" {
  name = "${var.project}-ec2"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project}-ec2"
  role = aws_iam_role.ec2.name
}

# Read invoices + handwritten notes with Textract (vendor-bill price capture +
# recipe OCR). These sync APIs don't support resource-level scoping → Resource "*".
resource "aws_iam_role_policy" "textract" {
  name = "${var.project}-textract"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["textract:AnalyzeExpense", "textract:DetectDocumentText", "textract:AnalyzeDocument"]
      Resource = "*"
    }]
  })
}

# Mise Copilot's brain: Claude on Bedrock (bill + handwritten-recipe understanding,
# and the in-app assistant). Inference is region-scoped; model access itself is
# granted once in the Bedrock console. Resource "*" because the model id is
# configurable (BEDROCK_MODEL_ID) and cross-region inference profiles resolve to
# several underlying model ARNs.
resource "aws_iam_role_policy" "bedrock" {
  name = "${var.project}-bedrock"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = "*"
    }]
  })
}

# Read/write app uploads in the private S3 bucket (document storage).
resource "aws_iam_role_policy" "s3_uploads" {
  name = "${var.project}-s3-uploads"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.uploads.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.uploads.arn
      }
    ]
  })
}

# CloudWatch Logs — the containers ship their logs here via the awslogs driver
# (see user_data.sh.tftpl). Applied by hand on the running box first; without it
# in terraform a replaced instance would lose the permission and fall back to
# local logs that die with the box.
resource "aws_iam_role_policy" "cloudwatch_logs" {
  name = "${var.project}-cloudwatch-logs"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams",
      ]
      # Scoped to our own groups — an instance role that can write anywhere in
      # CloudWatch can also bury evidence in someone else's log group.
      Resource = "arn:aws:logs:${var.region}:*:log-group:/dineai/*"
    }]
  })
}
