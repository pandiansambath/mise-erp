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
  "Parameter Store":
    "https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html",
  VPC: "https://docs.aws.amazon.com/vpc/",
  "Security Groups":
    "https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html",
  Subnets: "https://docs.aws.amazon.com/vpc/latest/userguide/configure-subnets.html",
  ECR: "https://docs.aws.amazon.com/ecr/",
  "API Gateway": "https://docs.aws.amazon.com/apigateway/",
  ALB: "https://docs.aws.amazon.com/elasticloadbalancing/latest/application/",
  RDS: "https://docs.aws.amazon.com/rds/",
  "Secrets Manager": "https://docs.aws.amazon.com/secretsmanager/",
  EventBridge: "https://docs.aws.amazon.com/eventbridge/",
  CloudWatch: "https://docs.aws.amazon.com/cloudwatch/",
  CloudTrail: "https://docs.aws.amazon.com/cloudtrail/",
  CodeArtifact: "https://docs.aws.amazon.com/codeartifact/",
  // Python & backend
  Python: "https://docs.python.org/3/",
  SQL: "https://en.wikipedia.org/wiki/SQL",
  "Java (AI-assisted)": "https://docs.oracle.com/en/java/",
  FastAPI: "https://fastapi.tiangolo.com/",
  Pydantic: "https://docs.pydantic.dev/",
  "Django REST": "https://www.django-rest-framework.org/",
  "Apache Camel": "https://camel.apache.org/docs/",
  "REST APIs": "https://en.wikipedia.org/wiki/REST",
  Microservices: "https://en.wikipedia.org/wiki/Microservices",
  "Event-driven": "https://en.wikipedia.org/wiki/Event-driven_architecture",
  DSA: "https://en.wikipedia.org/wiki/Data_structure",
  // Messaging & data
  "IBM MQ": "https://www.ibm.com/docs/en/ibm-mq",
  ActiveMQ: "https://activemq.apache.org/components/classic/documentation",
  "Apache Kafka": "https://kafka.apache.org/documentation/",
  "TCP/IP sockets": "https://en.wikipedia.org/wiki/Network_socket",
  "IBM TPF": "https://www.ibm.com/docs/en/ztpf",
  "Binary protocols": "https://en.wikipedia.org/wiki/Binary_protocol",
  PostgreSQL: "https://www.postgresql.org/docs/",
  Supabase: "https://supabase.com/docs",
  // DevOps & testing
  Terraform: "https://developer.hashicorp.com/terraform/docs",
  Pytest: "https://docs.pytest.org/",
  Playwright: "https://playwright.dev/docs/intro",
  JIRA: "https://support.atlassian.com/jira-software-cloud/",
  Confluence: "https://support.atlassian.com/confluence-cloud/",
  Docker: "https://docs.docker.com/",
  "GitHub Actions": "https://docs.github.com/actions",
  "Git & GitHub": "https://git-scm.com/doc",
  SonarQube: "https://docs.sonarsource.com/sonarqube-server/latest/",
  Snyk: "https://docs.snyk.io/",
  CodeScene: "https://codescene.io/docs/",
  // Generative AI
  "Amazon Bedrock": "https://docs.aws.amazon.com/bedrock/",
  Claude: "https://platform.claude.com/docs/en/home",
  MCP: "https://modelcontextprotocol.io/",
  RAG: "https://en.wikipedia.org/wiki/Retrieval-augmented_generation",
  "Anthropic SDK": "https://github.com/anthropics/anthropic-sdk-python",
  "Multi-agent": "https://en.wikipedia.org/wiki/Multi-agent_system",
  "Vector DBs": "https://en.wikipedia.org/wiki/Vector_database",
  "Tool use": "https://platform.claude.com/docs/en/home",
  "Human-in-the-loop": "https://en.wikipedia.org/wiki/Human-in-the-loop",
  // Frontend (built AI-assisted) & the AI tools he builds with
  "Next.js": "https://nextjs.org/docs",
  React: "https://react.dev/",
  TypeScript: "https://www.typescriptlang.org/docs/",
  "Tailwind CSS": "https://tailwindcss.com/docs",
  "Claude Code": "https://github.com/anthropics/claude-code",
  "OpenAI Codex": "https://openai.com/codex/",
  "Google Antigravity": "https://antigravity.google/",
  "AWS Kiro": "https://kiro.dev/",
};

export type Cluster = {
  /** Its heading on its card (the label is its short name). */
  head: string;
  key: string;
  label: string;
  hue: string;
  glyph: string;
  blurb: string;
  items: string[];
};

// Synced with his résumé's TECHNICAL SKILLS (v2, 21 Nov 2026) on 22 Nov —
// "add if any skill missing (check resume and sync)". Its nine groups, merged
// into six cards; "AI-assisted" kept wherever the résumé says it.
export const CLUSTERS: Cluster[] = [
  {
    key: "aws", head: "AWS · the bones",
    label: "AWS",
    hue: "var(--d-a2)",
    glyph: "☁",
    blurb: "These six cards are one body of work. This one is its bones: a place to run, a network to live in, keys only it may hold, and eyes that stay open at night.",
    items: [
      "EC2",
      "ECS",
      "ECR",
      "Lambda",
      "API Gateway",
      "ALB",
      "SQS",
      "SNS",
      "S3",
      "RDS",
      "DynamoDB",
      "VPC",
      "IAM",
      "Secrets Manager",
      "Parameter Store",
      "EventBridge",
      "CloudWatch",
      "CloudTrail",
      "CodeArtifact",
      "Security Groups",
      "Subnets",
    ],
  },
  {
    key: "python", head: "Python · the mind",
    label: "Python & backend",
    hue: "var(--d-b)",
    glyph: "🐍",
    blurb: "Where it thinks. I write the rule in Python first, then the service around it, then a clear door for others to knock on. Small parts, each easy to understand.",
    items: ["Python", "SQL", "Java (AI-assisted)", "FastAPI", "Pydantic", "Django REST", "Apache Camel", "REST APIs", "Microservices", "Event-driven", "DSA"],
  },
  {
    key: "ai", head: "Generative AI · the voice",
    label: "Generative AI",
    hue: "var(--d-d)",
    glyph: "✦",
    blurb: "Where it speaks. I build agents on Amazon Bedrock and Claude, and the fence with them: what they may read, what they may spend, and when they must ask a person.",
    items: [
      "Amazon Bedrock",
      "Claude",
      "Anthropic SDK",
      "AI agents",
      "Multi-agent",
      "MCP",
      "RAG",
      "Vector DBs",
      "Prompt engineering",
      "Tool use",
      "Human-in-the-loop",
      "LLM cost control",
    ],
  },
  {
    key: "integration", head: "Messaging · the nerves",
    label: "Messaging & data",
    hue: "var(--d-gold)",
    glyph: "⇄",
    blurb: "How one part feels what another did. I carry the word between old systems and new ones, by queue, stream, socket or mainframe, and give the data a place to rest.",
    items: ["IBM MQ", "ActiveMQ", "Apache Kafka", "TCP/IP sockets", "IBM TPF", "Binary protocols", "PostgreSQL", "Supabase"],
  },
  {
    key: "tools", head: "DevOps · the pulse",
    label: "DevOps & testing",
    hue: "var(--d-c)",
    glyph: "⚙",
    blurb: "The steady beat. Each thing is built the same way every time, read by tools that do not flatter, tested, and only then let go. Hope is not a test.",
    items: ["Terraform", "Docker", "GitHub Actions", "Git & GitHub", "SonarQube", "Snyk", "CodeScene", "Pytest", "Playwright", "JIRA", "Confluence"],
  },
  {
    key: "frontend", head: "Frontend · the face",
    label: "Frontend & AI tools",
    hue: "var(--d-b2)",
    glyph: "◇",
    blurb: "What you see and touch. I build it AI-assisted, with these tools every day, and I say so. The decisions stay mine.",
    items: ["Next.js", "React", "TypeScript", "Tailwind CSS", "Claude Code", "OpenAI Codex", "Google Antigravity", "AWS Kiro"],
  },
];

/** Which cluster a chip belongs to — the orbit colours by family. */
export const HUE_OF: Record<string, string> = Object.fromEntries(
  CLUSTERS.flatMap((c) => c.items.map((i) => [i, c.hue])),
);

/** Every skill, once, in the order the cards list them. */
export const ALL_SKILLS: string[] = [...new Set(CLUSTERS.flatMap((c) => c.items))];

/** The orbit round his portrait (22 Nov): "add if any skill missing… also add
 *  these too — RAG, MCP, Claude". Seventy chips cannot go round a phone's
 *  portrait at once, so each ring has a few PINNED chips that never change
 *  (the headline: Claude, MCP, RAG among them) and slots that take the next
 *  skill from ALL_SKILLS each time they pass behind him — out of sight — so
 *  every skill on the résumé comes round. `maxLen` keeps long names on the
 *  outer rings, where there is room. */
export const ORBIT_RINGS: { slots: number; pinned: string[]; maxLen: number }[] = [
  { slots: 5, pinned: ["Python", "Claude", "RAG"], maxLen: 7 },
  { slots: 7, pinned: ["MCP", "Amazon Bedrock", "Lambda"], maxLen: 12 },
  { slots: 8, pinned: ["FastAPI", "Docker"], maxLen: 15 },
];
/** Names longer than the outer ring takes stay on the cards only — on a
 *  phone's orbit they ran into each other ("Parameter Store", "Prompt
 *  engineering", "Google Antigravity"…). */
export const ORBIT_MAX_LEN = 15;

/** A skill in the orbit: `pin` keeps it in sight always, the others take turns. */
export type OrbitSkill = { name: string; pin: boolean };

/** The orbit's skills as the résumé gives them (§102.6): the pinned headline
 *  first, ring by ring, then every other skill short enough for a ring, in the
 *  cards' order. His own list (owner panel → Template) replaces it. */
export const DEFAULT_ORBIT: OrbitSkill[] = [
  ...ORBIT_RINGS.flatMap((r) => r.pinned.map((name) => ({ name, pin: true }))),
  ...ALL_SKILLS.filter((s) => !ORBIT_RINGS.some((r) => r.pinned.includes(s)) && s.length <= ORBIT_MAX_LEN).map((name) => ({ name, pin: false })),
];

/** The résumé's spelling of a skill typed in any case ("docker" → "Docker"). */
export function canonSkill(name: string): string {
  const low = name.toLowerCase();
  return ALL_SKILLS.find((s) => s.toLowerCase() === low) ?? name;
}

/** A skill's colour: its family's, or (one of his own) a family's, chosen by its name. */
export function hueOf(name: string): string {
  const known = HUE_OF[name];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CLUSTERS[h % CLUSTERS.length].hue;
}

export const EDUCATION = {
  degree: "B.Tech Information Technology",
  school: "Panimalar Institute of Technology",
  affiliation: "Affiliated to Anna University, Chennai",
  year: "2019 – 2023",
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
  //
  // `#page=35` opens it at his name in a desktop browser's PDF viewer
  // (Chrome, Edge, Brave, Firefox). A phone that downloads the file instead
  // still has the hint below.
  verifyUrl: "/api/dev-site/RANK_AFF_UG_2023.pdf#page=35",
  verifyLabel: "Anna University rank list (PDF)",
  // Where to look once it opens. A 49-page PDF with no pointer is only
  // technically evidence — nobody scrolls a stranger's rank list.
  verifyHint: "opens at page 35 · B.Tech Information Technology · rank 17",
  // The university itself, as the source behind the mirror.
  officialUrl: "https://www.annauniv.edu/",
  schoolUrl: "https://www.panimalar.ac.in/",
};
