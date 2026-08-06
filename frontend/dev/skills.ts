// The single source of truth for what he works with.
//
// One list, imported by the orbit, the cluster cards and the terminal. When
// these lived in three places they drifted — the terminal was still claiming
// SQL long after he said he doesn't work in it.
//
// Grouped the way he described them, not the way a CV template would:
// AWS is one world with a security half, Python is a language plus what he
// builds with it, and tooling is the pipeline around both.

/** Where each skill's official documentation lives.
 *
 *  His ask: "literally make everything as links". Official docs only — a
 *  portfolio that links to a blog post about FastAPI says something different
 *  from one that links to FastAPI. Kept in one map so the orbit and the cards
 *  cannot drift apart. */
export const DOCS: Record<string, string> = {
  // AWS
  EC2: "https://docs.aws.amazon.com/ec2/",
  ECS: "https://docs.aws.amazon.com/ecs/",
  Lambda: "https://docs.aws.amazon.com/lambda/",
  S3: "https://docs.aws.amazon.com/s3/",
  DynamoDB: "https://docs.aws.amazon.com/dynamodb/",
  SQS: "https://docs.aws.amazon.com/sqs/",
  SNS: "https://docs.aws.amazon.com/sns/",
  IAM: "https://docs.aws.amazon.com/iam/",
  VPC: "https://docs.aws.amazon.com/vpc/",
  "Security Groups":
    "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html",
  Subnets: "https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html",
  // Python
  Python: "https://docs.python.org/3/",
  FastAPI: "https://fastapi.tiangolo.com/",
  Django: "https://docs.djangoproject.com/",
  DSA: "https://en.wikipedia.org/wiki/Data_structure",
  // Tooling
  Docker: "https://docs.docker.com/",
  "GitHub Actions": "https://docs.github.com/actions",
  "Git & GitHub": "https://git-scm.com/doc",
  SonarQube: "https://docs.sonarsource.com/sonarqube-server/latest/",
  Snyk: "https://docs.snyk.io/",
  CodeScene: "https://codescene.io/docs/",
};

export type Cluster = {
  key: string;
  label: string;
  hue: string;
  glyph: string;
  blurb: string;
  items: string[];
};

export const CLUSTERS: Cluster[] = [
  {
    key: "aws",
    label: "AWS",
    hue: "#f0a064",
    glyph: "☁",
    blurb: "Compute, messaging and storage — plus the network and identity around them.",
    items: [
      "EC2",
      "ECS",
      "Lambda",
      "S3",
      "DynamoDB",
      "SQS",
      "SNS",
      "IAM",
      "VPC",
      "Security Groups",
      "Subnets",
    ],
  },
  {
    key: "python",
    label: "Python",
    hue: "#2dd4bf",
    glyph: "🐍",
    blurb: "The language, the frameworks he builds services in, and the fundamentals underneath.",
    items: ["Python", "FastAPI", "Django", "DSA"],
  },
  {
    key: "tools",
    label: "Tooling",
    hue: "#9b8cff",
    glyph: "⚙",
    blurb: "How the code ships, and what keeps it honest on the way.",
    items: ["Docker", "GitHub Actions", "Git & GitHub", "SonarQube", "Snyk", "CodeScene"],
  },
];

/** Which cluster a chip belongs to — the orbit colours by family. */
export const HUE_OF: Record<string, string> = Object.fromEntries(
  CLUSTERS.flatMap((c) => c.items.map((i) => [i, c.hue])),
);

/** The orbit cannot carry twenty chips on a phone. These are the ones that go
 *  round; the cluster cards below carry every single one, always. */
export const ORBIT_RINGS: { items: string[]; period: number; dir: 1 | -1 }[] = [
  { items: ["Python", "FastAPI", "Django", "DSA"], period: 28, dir: 1 },
  { items: ["EC2", "ECS", "Lambda", "S3", "DynamoDB", "SQS"], period: 46, dir: -1 },
  { items: ["IAM", "VPC", "Docker", "GitHub Actions", "SonarQube", "Snyk"], period: 68, dir: 1 },
];

export const EDUCATION = {
  degree: "B.Tech Information Technology",
  school: "Panimalar Institute of Technology",
  affiliation: "Affiliated to Anna University, Chennai",
  year: "2023",
  honour: "17th University Rank · Gold Medalist",
  percentage: "92%",
  exam: "Anna University · Rank List, April / May 2023 examinations",
  // Self-hosted, deliberately.
  //
  // The direct link on the mirror (m.stucor.in) answers 302 to a sign-in wall
  // for anyone without a session — I followed it rather than assuming. A
  // "verify" button that lands a recruiter on a login form proves nothing and
  // reads worse than no link: they leave, having been invited to check a claim
  // they then couldn't.
  //
  // This is the same public university document, served from our own origin.
  // No login, no third party, no chance of it disappearing.
  verifyUrl: "/dev/RANK_AFF_UG_2023.pdf",
  verifyLabel: "Anna University rank list (PDF)",
  // Where to look once it opens. A 49-page PDF with no pointer is only
  // technically evidence — nobody scrolls a stranger's rank list.
  verifyHint: "page 35 · B.Tech Information Technology · rank 17",
  // The university itself, as the source behind the mirror.
  officialUrl: "https://www.annauniv.edu/",
  schoolUrl: "https://www.panimalar.ac.in/",
};
