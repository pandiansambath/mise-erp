"use client";

/** Customise — your public page and your staff sign-in page, in one place.
 *
 *    "that customisation page we need enhancement bro. Features are [not] user
 *     friendly — please build that customisation page alone from the scratch
 *     again."
 *    "also we have only feature to customise landing hotel page, but for login
 *     where is the feature?"
 *
 *  THE SECOND COMPLAINT WAS THE DIAGNOSIS.
 *
 *  The login editor already existed. It was inside Settings, behind a "studio"
 *  mode you had to know to open, and it defaults to OFF. So he had styled his
 *  public page, never found the door, and reasonably concluded the feature was
 *  missing. The live database agreed: of the restaurants with a customised
 *  landing page, one had its sign-in door switched on and one had never touched
 *  it — which is also the whole of the "it works for me but not my friend's
 *  hotel" report.
 *
 *  So the fix is not more controls. It is making both pages VISIBLE AT ONCE,
 *  with their on/off state on the face of the card. You cannot fail to find a
 *  feature that is one of two things on the screen when you arrive.
 *
 *  Three things follow from that:
 *
 *  · Its own route, not a mode inside Settings. Settings is where you go to
 *    change a setting; this is design work, and it needs the whole width.
 *  · The preview is the page at its real size, photographed down — see
 *    `PagePreview`. A 400px box is a different page, not a smaller one.
 *  · A shelf of 96 pictures rather than a search box, because "pick one you
 *    like" is a job a restaurant owner can actually do.
 */

import { useEffect, useMemo, useState } from "react";
import { Select } from "@/components/Select";

import { ImageShelf } from "@/components/pages/ImageShelf";
import { DeviceSwitch, PagePreview, type Device } from "@/components/pages/PagePreview";
import HotelSite, {
  DEFAULT_LANDING,
  HERO_STYLES,
  LANDING_THEMES,
} from "@/components/site/HotelSite";
import {
  DEFAULT_LOGIN,
  HotelDoor,
  LOGIN_EFFECTS,
  LOGIN_LAYOUTS,
  type LoginConfig,
} from "@/components/auth/HotelDoor";
import { Card, PageHeader, Spinner, Toggle } from "@/components/ui";
import { API_BASE, api, type Hotel, type HotelLanding, type LandingConfig } from "@/lib/api";

type Which = "site" | "door";

export default function CustomisePage() {
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [which, setWhich] = useState<Which | null>(null);
  const [device, setDevice] = useState<Device>("desktop");

  const [land, setLand] = useState<LandingConfig>({});
  const [door, setDoor] = useState<LoginConfig>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Hotel>("/hotels/me")
      .then((h) => {
        setHotel(h);
        setLand((h.landing ?? {}) as LandingConfig);
        setDoor((h.login_page ?? {}) as LoginConfig);
      })
      .catch(() => setHotel(null));
  }, []);

  // The real page components take the same shape the public endpoint serves,
  // so the preview is the page rather than a drawing of it.
  const previewData: HotelLanding = useMemo(
    () => ({
      hotel_id: hotel?.id ?? "preview",
      name: hotel?.name ?? "Your restaurant",
      username: hotel?.username ?? "yourhotel",
      city: hotel?.city ?? null,
      has_logo: !!hotel?.has_logo,
      // `Hotel` carries `has_logo`, not a URL — the logo lives at a known path
      // off the hotel id, which is how every other surface fetches it.
      logo_url: hotel?.has_logo ? `/api/hotels/${hotel.id}/logo` : null,
      order_url: hotel?.username ? `https://${hotel.username}.dineai.cloud/order` : "",
      theme: hotel?.theme ?? null,
      landing: { ...DEFAULT_LANDING, ...(land ?? {}) } as Required<LandingConfig>,
      menu: [],
    }),
    [hotel, land],
  );

  async function save(what: Which) {
    setSaving(true);
    setSaved(null);
    setSaveErr(null);
    try {
      await api.patch("/hotels/me", what === "site" ? { landing: land } : { login_page: door });
      setSaved(what === "site" ? "Public page saved" : "Sign-in page saved");
      setTimeout(() => setSaved(null), 2600);
    } catch {
      // A FAILURE WAS BEING PAINTED GREEN. Both outcomes went into one
      // `saved` string rendered through `mise-tone-good`, so "Could not
      // save — try again" arrived in the colour that means it worked.
      setSaveErr("Could not save — try again");
    } finally {
      setSaving(false);
    }
  }

  if (!hotel) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Spinner />
      </div>
    );
  }

  const liveUrl = `https://${hotel.username ?? ""}.dineai.cloud`;

  // ── the chooser ─────────────────────────────────────────────────────────
  if (which === null) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Customise"
          subtitle="The two pages the outside world sees. Both are yours to style."
        />

        {!hotel.username && (
          /* A hotel with no handle has no address, so neither page can exist.
             Found in the live data: one restaurant is in exactly this state and
             nothing anywhere told them. */
          <Card className="mise-tone-warn text-sm">
            This restaurant doesn&apos;t have a web address yet, so neither page is
            reachable. Set a handle in Settings first — your pages will live at{" "}
            <b>yourname.dineai.cloud</b>.
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <PageCard
            title="Your public page"
            blurb="What a diner finds when they look you up. Photos, your story, opening hours, a button to order."
            where={hotel.username ? liveUrl : "not published yet"}
            on
            onOpen={() => setWhich("site")}
            preview={
              <PagePreview device="phone">
                <HotelSite data={previewData} config={land} preview />
              </PagePreview>
            }
          />
          <PageCard
            title="Your staff sign-in page"
            blurb="What your team sees at the start of a shift. Off means everyone gets the standard DineAI door."
            where={hotel.username ? `${liveUrl}/login` : "not published yet"}
            on={!!door.enabled}
            onOpen={() => setWhich("door")}
            preview={
              <PagePreview device="phone">
                <HotelDoor
                  cfg={{ ...door, enabled: true }}
                  hotelName={hotel.name}
                  logoUrl={hotel.has_logo ? `${API_BASE}/api/hotels/${hotel.id}/logo` : null}
                  hotelTheme={hotel.theme}
                  preview
                >
                  <PreviewForm />
                </HotelDoor>
              </PagePreview>
            }
          />
        </div>
      </div>
    );
  }

  // ── the editor ──────────────────────────────────────────────────────────
  const isSite = which === "site";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setWhich(null)}
          className="mise-press mise-well rounded-xl px-3 py-2 text-sm text-fg-soft"
        >
          ← Both pages
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl font-bold text-fg">
            {isSite ? "Your public page" : "Your staff sign-in page"}
          </h1>
          <p className="text-[11px] text-fg-faint">
            {isSite ? liveUrl : `${liveUrl}/login`}
          </p>
        </div>
        <DeviceSwitch device={device} onChange={setDevice} />
        <button
          type="button"
          disabled={saving}
          onClick={() => save(which)}
          className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {saved && <p className="mise-tone-good text-sm font-medium">{saved}</p>}
      {saveErr && (
        <p role="alert" className="mise-tone-bad text-sm font-medium">
          {saveErr}
        </p>
      )}

      {/* Preview FIRST and wide. The controls are the small half — what you are
          looking at is the page, not the form. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        {/* A REAL HEIGHT, because `PagePreview` fits to the room it is given and
            a block card offers none. 70dvh rather than 70vh: on a phone `vh`
            counts the strip under the collapsing address bar, so the frame is
            sized against space that is not on screen and its bottom is cut off
            — the same fault as in the studio, in a different container. */}
        <div className="mise-card-inset flex h-[70dvh] min-h-0 flex-col rounded-2xl p-4">
          {isSite ? (
            <PagePreview device={device} note={saving ? "saving…" : null}>
              <HotelSite data={previewData} config={land} preview />
            </PagePreview>
          ) : (
            <PagePreview
              device={device}
              note={door.enabled ? null : "currently OFF — your team sees the standard door"}
            >
              <HotelDoor
                cfg={{ ...door, enabled: true }}
                hotelName={hotel.name}
                logoUrl={hotel.has_logo ? `${API_BASE}/api/hotels/${hotel.id}/logo` : null}
                hotelTheme={hotel.theme}
                preview
              >
                <PreviewForm />
              </HotelDoor>
            </PagePreview>
          )}
        </div>

        <div className="space-y-4">
          {isSite ? (
            <SiteControls land={land} setLand={setLand} />
          ) : (
            <DoorControls door={door} setDoor={setDoor} />
          )}
        </div>
      </div>
    </div>
  );
}

/** A stand-in for the real sign-in form.
 *
 *  `HotelDoor` takes the form as a child, because the live one is an audited
 *  component that talks to the auth endpoints — which has no place inside a
 *  preview. Passing an empty div, as I first did, left a white blob floating
 *  where the form should be and made the whole preview look broken.
 *
 *  This is deliberately inert: no inputs that can take focus, no button that
 *  can be pressed. It exists so the owner can see how their headline sits
 *  NEXT TO the form, which is the only thing the layout choice affects.
 */
function PreviewForm() {
  return (
    <div className="w-full space-y-3" aria-hidden>
      {["Email", "Password"].map((label) => (
        <div key={label}>
          <p
            className="mb-1 text-xs font-medium"
            style={{ color: "var(--door-soft, #888)" }}
          >
            {label}
          </p>
          <div
            className="h-10 w-full rounded-xl"
            style={{
              background: "var(--door-panel, rgba(255,255,255,.08))",
              border: "1px solid var(--door-line, rgba(255,255,255,.15))",
            }}
          />
        </div>
      ))}
      <div
        className="grid h-11 w-full place-items-center rounded-xl text-sm font-semibold text-white"
        style={{ background: "linear-gradient(135deg, var(--door-a), var(--door-b))" }}
      >
        Sign in
      </div>
    </div>
  );
}

function PageCard({
  title,
  blurb,
  where,
  on,
  preview,
  onOpen,
}: {
  title: string;
  blurb: string;
  where: string;
  on: boolean;
  preview: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mise-card-inset mise-feel group flex flex-col gap-3 rounded-2xl p-4 text-left"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold text-fg">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-soft">{blurb}</p>
        </div>
        {/* The state, on the face of the card. This is the whole reason the
            sign-in editor was invisible for months. */}
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
            on ? "bg-emerald-500/15 text-emerald-500" : "bg-glass/15 text-fg-faint"
          }`}
        >
          {on ? "● On" : "Off"}
        </span>
      </div>
      {/* A HEIGHT AS WELL AS A WIDTH. `PagePreview` fits to both axes, so a
          container with only a width leaves the height term measuring the
          frame's own content — which is not a constraint, it is an echo. 26rem
          is about what a 390x844 phone comes to at this width, so the width is
          what actually binds here and the height is simply a floor that stops
          the card growing if the device ever changes. */}
      <div className="pointer-events-none mx-auto flex h-[26rem] w-full max-w-[13rem] flex-col">
        {preview}
      </div>
      <p className="truncate text-[11px] text-fg-faint">{where}</p>
      <span className="mise-press w-fit rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white">
        Customise →
      </span>
    </button>
  );
}

const FIELD = "mise-well w-full rounded-xl px-3 py-2 text-sm outline-none";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mise-card-inset rounded-2xl p-3.5">
      <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
        {title}
      </p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-fg-soft">{label}</span>
      {children}
    </label>
  );
}

function Swatches({
  a,
  b,
  onA,
  onB,
}: {
  a: string;
  b: string;
  onA: (v: string) => void;
  onB: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      {[
        [a, onA, "Main"],
        [b, onB, "Second"],
      ].map(([v, set, label]) => (
        <label key={label as string} className="mise-well flex flex-1 items-center gap-2 rounded-xl px-2 py-1.5">
          <input
            type="color"
            value={v as string}
            onChange={(e) => (set as (s: string) => void)(e.target.value)}
            className="h-7 w-7 cursor-pointer rounded-md border-0 bg-transparent p-0"
          />
          <span className="text-[11px] text-fg-faint">{label as string}</span>
        </label>
      ))}
    </div>
  );
}

function SiteControls({
  land,
  setLand,
}: {
  land: LandingConfig;
  setLand: (c: LandingConfig) => void;
}) {
  const L = { ...DEFAULT_LANDING, ...land };
  const set = <K extends keyof LandingConfig>(k: K, v: LandingConfig[K]) =>
    setLand({ ...land, [k]: v });

  return (
    <>
      <Group title="Picture">
        <ImageShelf
          page="landing"
          value={(L.photo as string) || null}
          onPick={(f) => set("photo", f ?? "")}
        />
        {!L.photo && (
          <Row label="Or one of the built-in styles">
            <Select
              value={L.hero}
              onChange={(v) => set("hero", v)}
              ariaLabel="Hero style"
              options={HERO_STYLES.map((h) => ({ value: h.key, label: h.label }))}
            />
          </Row>
        )}
      </Group>

      <Group title="Words">
        <Row label="Tagline">
          <input
            value={L.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder="Proper South Indian, cooked to order"
            className={FIELD}
          />
        </Row>
        <Row label="Your story">
          <textarea
            rows={4}
            value={L.about}
            onChange={(e) => set("about", e.target.value)}
            className={FIELD}
          />
        </Row>
      </Group>

      <Group title="Colours">
        <Swatches
          a={L.accent}
          b={L.accent2}
          onA={(v) => set("accent", v)}
          onB={(v) => set("accent2", v)}
        />
        <Row label="Mood">
          <Select
            value={L.theme}
            onChange={(v) => set("theme", v as LandingConfig["theme"])}
            ariaLabel="Theme"
            options={LANDING_THEMES.map((t) => ({ value: t.key, label: t.label }))}
          />
        </Row>
      </Group>

      <Group title="Finding you">
        <Row label="Address">
          <input value={L.address} onChange={(e) => set("address", e.target.value)} className={FIELD} />
        </Row>
        <Row label="Phone">
          <input value={L.phone} onChange={(e) => set("phone", e.target.value)} className={FIELD} />
        </Row>
        <Row label="Opening hours">
          <textarea rows={3} value={L.hours} onChange={(e) => set("hours", e.target.value)} className={FIELD} />
        </Row>
      </Group>
    </>
  );
}

function DoorControls({
  door,
  setDoor,
}: {
  door: LoginConfig;
  setDoor: (c: LoginConfig) => void;
}) {
  const D = { ...DEFAULT_LOGIN, ...door };
  const set = <K extends keyof LoginConfig>(k: K, v: LoginConfig[K]) =>
    setDoor({ ...door, [k]: v });

  return (
    <>
      {/* FIRST, and unmissable. This switch defaulting to off, three clicks
          deep inside Settings, is the entire reason he believed the feature did
          not exist. */}
      <div
        className={`rounded-2xl p-3.5 transition ${
          D.enabled ? "bg-emerald-500/10 ring-1 ring-emerald-500/30" : "mise-card-inset"
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-fg">Use your own sign-in page</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-fg-soft">
              {D.enabled
                ? "Your team sees this page when they sign in."
                : "Off — your team currently sees the standard DineAI door. Nothing below applies until you turn this on."}
            </p>
          </div>
          <Toggle on={!!D.enabled} onChange={(v) => set("enabled", v)} />
        </div>
      </div>

      <Group title="Picture">
        <ImageShelf
          page="login"
          value={(D.photo as string) || null}
          onPick={(f) => set("photo", f ?? "")}
        />
      </Group>

      <Group title="Words">
        <Row label="Headline">
          <input
            value={D.headline}
            onChange={(e) => set("headline", e.target.value)}
            placeholder="Welcome back"
            className={FIELD}
          />
        </Row>
        <Row label="Under it">
          <input
            value={D.subline}
            onChange={(e) => set("subline", e.target.value)}
            placeholder="Sign in to start your shift."
            className={FIELD}
          />
        </Row>
        <Row label="A note at the foot">
          <input
            value={D.footer}
            onChange={(e) => set("footer", e.target.value)}
            placeholder="Staff only — lost your password? Ask Sam."
            className={FIELD}
          />
        </Row>
      </Group>

      <Group title="Shape">
        <Row label="Where the form sits">
          <Select
            value={D.layout}
            onChange={(v) => set("layout", v as LoginConfig["layout"])}
            ariaLabel="Sign-in layout"
            // The hint becomes a second line rather than a dash in the middle
            // of the label, which is what `SelectOption.hint` is for.
            options={LOGIN_LAYOUTS.map((l) => ({ value: l.key, label: l.label, hint: l.hint }))}
          />
        </Row>
        <Row label="Movement">
          <Select
            value={D.effect}
            onChange={(v) => set("effect", v as LoginConfig["effect"])}
            ariaLabel="Sign-in effect"
            options={LOGIN_EFFECTS.map((l) => ({ value: l.key, label: l.label, hint: l.hint }))}
          />
        </Row>
      </Group>

      <Group title="Colours">
        <Swatches
          a={D.accent}
          b={D.accent2}
          onA={(v) => set("accent", v)}
          onB={(v) => set("accent2", v)}
        />
      </Group>
    </>
  );
}
