/** What each line on the AWS bill actually IS, in words, and what to do about it.
 *
 *     "whats that ec2other ec2 other..serisly this entire page is not really
 *      that muhc detailed"
 *
 *  A bill line arrives as `EUW2-InstanceUsage:db.t4g.micro`. That is precise,
 *  auditable, and tells the person paying it nothing. The old page showed the
 *  SERVICE name instead, which is worse: three separate RDS lines all rendered
 *  as "Amazon Relational ..." at 6.43, 1.32 and 0.10, and thirteen distinct
 *  free lines all rendered as the identical words "EC2 - Other".
 *
 *  So: plain English first, the AWS key underneath, and — the part that makes
 *  this a money page rather than a report — THE LEVER. Every line that costs
 *  real money has something you could actually do about it, and a cost you
 *  cannot act on is trivia.
 *
 *  ⚠️ NEVER match on the SERVICE name alone. `EC2 - Other` is two pools (EBS
 *  disk belongs to the shared box; data transfer belongs to the platform), and
 *  Bedrock's service key CONTAINS THE MODEL NAME — "Claude Sonnet 4.6 (Amazon
 *  Bedrock Edition)" — so it changes every time we change model. `usage_type`
 *  is the stable, meaningful key, which is exactly the field the old page threw
 *  away.
 *
 *  An unknown key is NOT an error and must never be hidden. It falls through to
 *  the raw service · usage_type and is tagged NEW, and it keeps its natural
 *  place in the ranked list — so a $12 line nobody has named lands at the top
 *  at full size, and a $0.00 one lands at the bottom where it belongs.
 */

export type LineInfo = {
  /** What it is, for somebody who does not know AWS. */
  label: string;
  /** One sentence: what generates this charge. */
  what: string;
  /** What you could do about it. Null where there is genuinely nothing. */
  lever: string | null;
};

/** Matched as a SUBSTRING of the usage type, longest key first, so
 *  `EUW2-RDS:GP3-Storage` cannot be swallowed by a shorter `RDS` rule. */
const RULES: [string, LineInfo][] = [
  // ── the seven lines that are 99.94% of this bill ────────────────────────
  [
    "InstanceUsage:db.",
    {
      label: "Database — the server",
      what: "The RDS instance, charged by the hour whether anybody queries it or not.",
      lever: "The single biggest line. A smaller instance class is the only real saving.",
    },
  ],
  [
    "RDS:GP3-Storage",
    {
      label: "Database — the disk",
      what: "Provisioned RDS storage, charged per GB-month.",
      lever: "Allocated, not used — shrinking it needs a restore, so size it once and leave it.",
    },
  ],
  [
    "BoxUsage:",
    {
      label: "The app server",
      what: "The EC2 box the whole application runs on, charged by the hour.",
      lever: "Paid whether one restaurant uses it or fifty. Only a resize changes it.",
    },
  ],
  [
    "PublicIPv4:InUseAddress",
    {
      label: "The public IP address",
      what: "AWS charges for every IPv4 address now, attached or idle.",
      lever: "One address per box. An IP left behind after a rebuild bills forever — check for spares.",
    },
  ],
  [
    "TimedStorage-ByteHrs",
    {
      label: "Docker images (ECR)",
      what: "Every image version we have ever pushed, charged per GB-month.",
      lever: "Keep at most 3 images per repo via a lifecycle policy. This hit $2.53 in August.",
    },
  ],
  [
    "EBS:VolumeUsage",
    {
      label: "The app server's disk",
      what: "The EBS volume under the EC2 box.",
      lever: "Grows only if we grow it. An unattached volume from an old box still bills.",
    },
  ],
  // ── AI. The service key carries the model name, so match the usage type ──
  [
    "CacheWriteInput",
    {
      label: "AI — writing the prompt cache",
      what: "Storing a reusable prompt prefix so later calls are cheaper.",
      lever: "Pays for itself across repeated calls; a one-off call it just costs.",
    },
  ],
  [
    "CacheReadInput",
    {
      label: "AI — reading the prompt cache",
      what: "Re-using a cached prompt prefix. About a tenth the price of sending it again.",
      lever: "This line going UP while input tokens go down is the cache working.",
    },
  ],
  [
    "InputTokenCount",
    {
      label: "AI — what we send",
      what: "Tokens sent to the model: the question plus the context we attach.",
      lever: "Attaching less context is the cheapest saving available on AI.",
    },
  ],
  [
    "OutputTokenCount",
    {
      label: "AI — what it says back",
      what: "Tokens generated. Roughly five times the price of input.",
      lever: "Shorter answers cost less. Model tier matters more — Haiku is a fraction of Sonnet.",
    },
  ],
  // ── network ─────────────────────────────────────────────────────────────
  [
    "-AWS-In-Bytes",
    {
      label: "Data coming in",
      what: "Traffic arriving from another AWS region.",
      // The thirteen "unclassified" lines he asked about. Free, every one.
      lever: null,
    },
  ],
  [
    "-AWS-Out-Bytes",
    {
      label: "Data going out",
      what: "Traffic leaving to another AWS region.",
      lever: null,
    },
  ],
  [
    "DataTransfer-Out-Bytes",
    {
      label: "Data out to the internet",
      what: "Everything served to browsers and phones. The first 100 GB a month is free.",
      lever: "Grows with real traffic. Images are usually most of it.",
    },
  ],
  // ── the ones that are alarms in themselves ──────────────────────────────
  [
    "NatGateway",
    {
      label: "⚠ NAT gateway",
      what: "A managed gateway for private-subnet egress.",
      lever: "About $35/month the moment it exists. We should not have one — check why it does.",
    },
  ],
  [
    "LoadBalancerUsage",
    {
      label: "⚠ Load balancer",
      what: "An ELB, charged hourly.",
      lever: "About $18/month. We serve through Caddy on the box and do not need one.",
    },
  ],
  [
    "ElasticIP:IdleAddress",
    {
      label: "⚠ An IP address doing nothing",
      what: "An Elastic IP allocated but attached to nothing.",
      lever: "Pure waste. Release it.",
    },
  ],
  // ── small but real ──────────────────────────────────────────────────────
  [
    "APIRequest",
    {
      label: "This dashboard reading the bill",
      what: "Cost Explorer charges a cent per call. This page's own cost.",
      lever: "Capped in code: 2 scheduled reads a day, 150 calls a month maximum.",
    },
  ],
  [
    "TimedStorage-ByteHrs-Polly",
    {
      label: "Speech synthesis",
      what: "Amazon Polly turning the assistant's replies into audio.",
      lever: null,
    },
  ],
  [
    "Requests-Tier",
    {
      label: "File storage requests",
      what: "S3 reads and writes for uploaded documents and photographs.",
      lever: null,
    },
  ],
  [
    "TimedStorage",
    {
      label: "File storage",
      what: "S3 storage for documents and photographs, per GB-month.",
      lever: null,
    },
  ],
];

const SORTED = [...RULES].sort((a, b) => b[0].length - a[0].length);

/** Describe one bill line. `null` info means we have no rule — the caller must
 *  show the raw key and tag it NEW rather than hiding it. */
export function describeLine(
  service: string,
  usageType: string,
): LineInfo & { known: boolean; key: string } {
  const u = usageType || "";
  const hit = SORTED.find(([k]) => u.includes(k));
  if (hit) return { ...hit[1], known: true, key: `${service} · ${u}` };

  // Bedrock last, because its per-model service key is the unstable one and a
  // token line above would normally have caught it first.
  if (service.toLowerCase().includes("bedrock")) {
    return {
      label: "AI — Bedrock",
      what: `A Bedrock charge on ${service.replace(/ \(Amazon Bedrock Edition\)/, "")}.`,
      lever: "Model choice is the biggest lever on AI spend.",
      known: true,
      key: `${service} · ${u}`,
    };
  }

  return {
    label: service || "Unnamed charge",
    what: "We have no rule for this line yet, so it is shown exactly as AWS sends it.",
    lever: null,
    known: false,
    key: `${service} · ${u}`,
  };
}

/** One colour per POOL, so colour carries meaning instead of position.
 *  `CHART_COLORS[i]` made the eighth-largest line a different colour on a
 *  different day, which is a rainbow, not information. */
export const POOL_STYLE: Record<string, { fill: string; chip: string; label: string }> = {
  shared: {
    fill: "var(--brand-500, #8b1e3f)",
    chip: "bg-brand-600/15 text-brand-400",
    label: "the shared box",
  },
  direct: {
    fill: "#d97706",
    chip: "bg-amber-500/15 text-amber-500",
    label: "caused by use",
  },
  platform: {
    fill: "#64748b",
    chip: "bg-glass/20 text-fg-faint",
    label: "platform",
  },
  unclassified: {
    fill: "#94a3b8",
    chip: "bg-glass/20 text-fg-faint",
    label: "no rule yet",
  },
};
