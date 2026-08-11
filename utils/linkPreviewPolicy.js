function isPublicIpv4(hostname) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [first, second] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

export function canFetchLinkPreview(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return false;
    }

    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    if (
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      (!hostname.includes(".") && !hostname.includes(":"))
    ) {
      return false;
    }

    const publicIpv4 = isPublicIpv4(hostname);
    if (publicIpv4 !== null) return publicIpv4;

    if (hostname.includes(":")) {
      if (
        hostname === "::" ||
        hostname === "::1" ||
        /^fe[89ab]/.test(hostname) ||
        /^f[cd]/.test(hostname)
      ) {
        return false;
      }
      const mappedIpv4 = hostname.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (mappedIpv4) return isPublicIpv4(mappedIpv4[1]) === true;
    }

    return true;
  } catch {
    return false;
  }
}

// Metadata fetches always require an explicit tap. Incognito additionally
// explains the network contact in the UI, but never changes this safe default.
export function shouldAutoLoadLinkPreview() {
  return false;
}
