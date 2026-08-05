// The single source of truth for what he works with.
//
// One list, imported by the orbit, the cluster cards and the terminal. When
// these lived in three places they drifted — the terminal was still claiming
// SQL long after he said he doesn't work in it.
//
// Grouped the way he described them, not the way a CV template would:
// AWS is one world with a security half, Python is a language plus what he
// builds with it, and tooling is the pipeline around both.

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
  degree: "B.Tech",
  school: "Panimalar Institute of Technology",
  affiliation: "Affiliated to Anna University, Chennai",
  year: "2023",
  honour: "17th University Rank · Gold Medalist",
  exam: "Anna University rank list — April / May 2023 examinations",
  // The claim is checkable, which is the entire point of printing it. Anna
  // University publishes its rank lists on the official site.
  //
  // ⚠️ If you have the direct PDF for the Apr/May 2023 rank list, paste it
  // here — a deep link straight to the page carrying his name is worth far
  // more than a link to a homepage. It is left as the official site rather
  // than a guessed URL, because a verification link that 404s undermines the
  // exact thing it exists to prove.
  verifyUrl: "https://www.annauniv.edu/",
  verifyLabel: "annauniv.edu",
  schoolUrl: "https://www.panimalar.ac.in/",
};
