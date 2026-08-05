// A photograph, in the smallest format the browser will take.
//
// Photography is the heaviest thing this app ships and the slowest thing on a
// phone using a kitchen's wifi. WebP is ~48% smaller than these JPEGs at the
// same visual quality — measured on the real files by `scripts/to_webp.py`,
// not assumed.
//
// It is a <picture>, not a swapped src, on purpose: the browser picks, and one
// that cannot take WebP still gets the JPEG rather than a hole where the photo
// was. The saving comes from offering the choice, never from removing it.
//
// Everything else behaves like the <img> it replaces — same className, same
// style, same alt — so converting a usage is a one-line change.

type Props = {
  /** Path to the JPEG, e.g. "/experience/table.jpg". The .webp beside it is
   *  offered first; if the conversion was skipped because WebP came out
   *  bigger, the browser simply falls through to this. */
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  /** "eager" only for something above the fold that the page is judged on. */
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
};

export function Photo({
  src,
  alt = "",
  className,
  style,
  loading = "lazy",
  fetchPriority,
}: Props) {
  const webp = src.replace(/\.(jpe?g|png)$/i, ".webp");
  return (
    <picture>
      <source srcSet={webp} type="image/webp" />
      <img
        src={src}
        alt={alt}
        decoding="async"
        loading={loading}
        fetchPriority={fetchPriority}
        className={className}
        style={style}
      />
    </picture>
  );
}
