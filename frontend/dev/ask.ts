// A file, asked for again where it did not come: a phone's network, a server just being
// replaced. (One picture of eighteen that did not was a white chest: §106.14.)

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `anew`: not the one the browser has kept (that may be half of it). Throws when it will not
 *  come after all (about three and a half seconds later). */
export async function ask<T>(url: string, read: (r: Response) => Promise<T>, anew = false): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      const r = await fetch(url, anew || n ? { cache: "reload" } : undefined);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await read(r);
    } catch (e) {
      if (n >= 3) throw e;
      await wait(500 * 2 ** n);
    }
  }
}
