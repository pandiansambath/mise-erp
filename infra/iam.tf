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

# The assistant's brain: Claude on Bedrock — the in-app Copilot, bill reading,
# handwritten recipes, and the guest assistant on the table QR page.
#
# THIS WAS DELETED BY ACCIDENT in c8cc216 ("Textract is gone"). The Textract
# policy and this one sat next to each other, and removing Textract took Bedrock
# with it — so every AI feature started answering "the AI service is
# unavailable" with nothing in the app having changed. It cost a month.
#
# The failure was doubly hard to see because bedrock.py maps ANY AccessDenied to
# "Claude isn't switched on for this AWS account yet", which points at the
# Bedrock console — a place where everything was, correctly, already enabled.
#
# Resource "*" because the model id is configurable (BEDROCK_MODEL_ID) and the
# cross-region inference profiles resolve to several underlying model ARNs.
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

# The VOICE. Polly turns the assistant's reply into speech.
#
# Why Polly and not Nova Sonic, which is the obvious answer on an AWS stack:
#
#   * Nova Sonic's Python support is an EXPERIMENTAL awslabs SDK, not boto3.
#     A production dependency that ships with "experimental" on the tin, for
#     the one feature an owner talks to all day, is a bad trade.
#   * It is not in eu-west-2. London audio would cross to us-east-1 - a UK
#     restaurant's takings, read aloud, leaving the country.
#   * He said it himself: "anyway action done by claude". Claude already holds
#     every tool, every permission check and every bit of tuning we have done.
#
# So: the browser hears, Claude thinks, Polly speaks. All three stay in
# eu-west-2, all on SDKs that are not labelled experimental.
resource "aws_iam_role_policy" "polly" {
  name = "${var.project}-polly"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["polly:SynthesizeSpeech", "polly:DescribeVoices"]
      Resource = "*"
    }]
  })
}
