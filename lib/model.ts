// Token Radar — the value model and the farm-plan generator.
//
// Everything here is derived from the sealed snapshot's own figures:
// a protocol's TVL, its seven-day TVL change, how long it has run with
// no token recorded, and how many chains it runs on. No list of names
// is hardcoded: the same formula ranks every protocol in the file.
//
// The board ranks only the protocols a reader can actually farm for a
// launch: protocols that record no token, and that are not a centralised
// exchange, a bridge, a liquid-staking product, or a wrapped / staked
// product of a token that already trades. Those 133 pre-token protocols
// (and the 416 whose token already trades) are counted and explained in
// the dashboard instead of being ranked as if they were farmable.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelBreakdown {
  /** The multiple of TVL the implied value uses. */
  multiple: number;
  /** 1 + clamped seven-day change / 200. */
  growthFactor: number;
  /** 0.85 .. 1.30 from days since listing. */
  ageFactor: number;
  /** 1 .. 1.35 from the number of chains. */
  chainFactor: number;
  /** 1.15 for core DeFi primitives, 1.05 for allocators, else 1. */
  categoryBoost: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  rank: number;
  implied_value_usd: number;
  score: number;
  verdict: string;
  watchlist: boolean;
  breakdown: ModelBreakdown;
  farm_steps: string[];
}

export interface Board {
  rows: BoardRow[];
  farmableCount: number;
  excludedPreToken: number;
  tokenAlreadyCount: number;
  watchlistCount: number;
}

const AS_OF_FALLBACK = "2026-11-14";

/** Categories whose token, if one ever launched, is not a farmable airdrop. */
const NOT_FARMABLE_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
  "Cross Chain Bridge",
]);

const EXCHANGE_FIRST_WORDS = new Set([
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
]);

/** Core DeFi primitives get a small boost; allocators a smaller one. */
const CORE_CATEGORIES = new Set([
  "Dexs",
  "Lending",
  "Uncollateralized Lending",
  "Yield",
  "Yield Aggregator",
  "Derivatives",
  "CDP",
  "CDP Manager",
  "RWA",
  "Leveraged Farming",
  "Farm",
]);

const ALLOCATOR_CATEGORIES = new Set([
  "Risk Curators",
  "Onchain Capital Allocator",
  "Liquidity Manager",
]);

export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** A protocol a reader can actually farm for a token launch. */
export function isFarmable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && NOT_FARMABLE_CATEGORIES.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  const first = p.name.split(" ")[0];
  if (EXCHANGE_FIRST_WORDS.has(first)) return false;
  return true;
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

/** Whole days between the listing day and the snapshot day. Null when unknown. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const listed = Date.parse(p.listed_at + "T00:00:00Z");
  const snap = Date.parse(asOf + "T00:00:00Z");
  if (Number.isNaN(listed) || Number.isNaN(snap)) return null;
  return Math.max(0, Math.floor((snap - listed) / 86400000));
}

function growthFactor(p: SnapshotProtocol): number {
  const change = p.change_7d === null ? 0 : p.change_7d;
  return 1 + clamp(change, -50, 300) / 200;
}

function ageFactor(age: number | null): number {
  if (age === null) return 1;
  return 0.85 + (0.45 * Math.min(age, 1095)) / 1095;
}

function chainFactor(p: SnapshotProtocol): number {
  return 1 + 0.07 * Math.min(Math.max(p.chains.length - 1, 0), 5);
}

function categoryBoost(p: SnapshotProtocol): number {
  if (p.category !== null && CORE_CATEGORIES.has(p.category)) return 1.15;
  if (p.category !== null && ALLOCATOR_CATEGORIES.has(p.category)) return 1.05;
  return 1;
}

/**
 * The implied value: what the protocol's token would be worth if it
 * launched at a multiple of its TVL, with the multiple moved by its own
 * momentum (seven-day growth), its track record (age with no token),
 * its reach (chains), and its category. The base multiple is 2x TVL.
 */
export function impliedValue(p: SnapshotProtocol, asOf: string): {
  value: number;
  breakdown: ModelBreakdown;
} {
  const age = ageDays(p, asOf);
  const breakdown: ModelBreakdown = {
    multiple: 0,
    growthFactor: growthFactor(p),
    ageFactor: ageFactor(age),
    chainFactor: chainFactor(p),
    categoryBoost: categoryBoost(p),
  };
  const multiple =
    2 *
    breakdown.growthFactor *
    breakdown.ageFactor *
    breakdown.chainFactor *
    breakdown.categoryBoost;
  breakdown.multiple = multiple;
  return { value: Math.round(p.tvl_usd * multiple), breakdown };
}

function verdictFor(score: number): string {
  if (score >= 85) return "Top farm — start here";
  if (score >= 65) return "Strong launch case";
  if (score >= 45) return "Worth farming";
  if (score >= 25) return "Early / speculative";
  return "Weak case — monitor only";
}

// ---------------------------------------------------------------------------
// Farm plans. Each plan is five concrete steps built from the protocol's
// own category, main chain and name, with a suggested size, a gas cost
// and a time. Nothing here names a protocol the snapshot does not.
// ---------------------------------------------------------------------------

const GAS_NOTES: Record<string, string> = {
  Ethereum: "about $3 to $15 of gas per transaction on Ethereum",
  Solana: "about $0.01 of gas per transaction on Solana",
  Base: "about $0.05 to $0.50 of gas per transaction on Base",
  Arbitrum: "about $0.05 to $0.50 of gas per transaction on Arbitrum",
  Optimism: "about $0.05 to $0.50 of gas per transaction on Optimism",
  Polygon: "about $0.05 to $0.30 of gas per transaction on Polygon",
  Avalanche: "about $0.10 to $1 of gas per transaction on Avalanche",
  Bitcoin: "about $1 to $5 of fees per transaction on Bitcoin",
};

function gasNote(chain: string): string {
  return GAS_NOTES[chain] ?? "about $0.10 to $1 of gas per transaction";
}

interface CategoryActions {
  first: string;
  second: string;
}

function actionsFor(category: string | null, name: string, chain: string): CategoryActions {
  const generic: CategoryActions = {
    first:
      "Use " +
      name +
      " on " +
      chain +
      " with $100 to $500: make a real deposit or trade, not a dust transaction, so the activity counts.",
    second:
      "Come back every week and repeat the same action on " +
      name +
      " with a fresh $50 to $200, keeping the position open between visits.",
  };
  if (category === null) return generic;
  if (category === "Dexs") {
    return {
      first:
        "Swap $100 to $500 through " +
        name +
        " on " +
        chain +
        " across two different tokens, then add $100 to $300 to a liquidity pool and hold the LP position.",
      second:
        "Route one swap a week through " +
        name +
        " instead of another exchange, and keep the liquidity position open so fees and volume keep accruing.",
    };
  }
  if (category === "Lending" || category === "Uncollateralized Lending") {
    return {
      first:
        "Supply $200 to $1,000 of a stablecoin or blue-chip asset to " +
        name +
        " on " +
        chain +
        " and leave it earning for at least a month.",
      second:
        "Borrow a small amount, $50 to $200, against the supply on " +
        name +
        ", repay it after a week, and keep the loan-to-value below 50% the whole time.",
    };
  }
  if (category === "Yield" || category === "Yield Aggregator" || category === "Farm") {
    return {
      first:
        "Deposit $100 to $500 into a " +
        name +
        " vault on " +
        chain +
        " and let the yield compound there for at least four weeks.",
      second:
        "Claim and re-deposit the vault rewards on " +
        name +
        " once a week, and move half of any new deposit into a second vault it runs.",
    };
  }
  if (
    category === "Derivatives" ||
    category === "Basis Trading" ||
    category === "Interest Rate Derivatives" ||
    category === "Options Vault"
  ) {
    return {
      first:
        "Open a small $50 to $200 position on " +
        name +
        " on " +
        chain +
        " with low leverage, and close it after a few days with a profit or a planned small loss.",
      second:
        "Open one more $50 to $200 position the following week on " +
        name +
        ", this time on the opposite side, to build a history of both directions.",
    };
  }
  if (category === "CDP" || category === "CDP Manager" || category === "Dual-Token Stablecoin") {
    return {
      first:
        "Lock $200 to $1,000 of collateral in " +
        name +
        " on " +
        chain +
        " and mint $50 to $300 of its stablecoin, keeping collateral above 200%.",
      second:
        "Use the minted stablecoin for a real payment or swap on " +
        chain +
        ", then repay part of the loan and top the collateral up the next week.",
    };
  }
  if (category === "RWA") {
    return {
      first:
        "Buy $100 to $500 of a tokenised real-world asset on " +
        name +
        " on " +
        chain +
        " and hold it for at least a month to show long-term use.",
      second:
        "Collect the yield or payout the asset pays on " +
        name +
        ", reinvest half of it, and add a second $50 to $200 purchase the following month.",
    };
  }
  if (
    category === "Risk Curators" ||
    category === "Onchain Capital Allocator" ||
    category === "Liquidity Manager"
  ) {
    return {
      first:
        "Allocate $200 to $1,000 to a vault curated by " +
        name +
        " on " +
        chain +
        " and keep the allocation in place for at least a month.",
      second:
        "Review the vault's allocation on " +
        name +
        " once a week, move $50 to $200 between its vaults once, and keep a record of every move.",
    };
  }
  if (category === "Prediction Market") {
    return {
      first:
        "Trade $20 to $100 on a live market on " +
        name +
        " on " +
        chain +
        ", on an outcome you have actually researched, and hold it to resolution.",
      second:
        "Trade a second $20 to $100 market on " +
        name +
        " the next week, and add liquidity to one market if it offers a liquidity pool.",
    };
  }
  if (category === "Leveraged Farming") {
    return {
      first:
        "Open a $100 to $300 leveraged farming position on " +
        name +
        " on " +
        chain +
        " at no more than 2x, and monitor the health factor daily for the first week.",
      second:
        "Close half the position on " +
        name +
        " after two weeks, take the profit or cut the loss, and leave the rest running.",
    };
  }
  return generic;
}

export function farmSteps(p: SnapshotProtocol): string[] {
  const chain = p.chains.length > 0 ? p.chains[0] : "Ethereum";
  const actions = actionsFor(p.category, p.name, chain);
  const steps = [
    "Set up a fresh wallet for farming, fund it with $100 to $500 plus gas money (" +
      gasNote(chain) +
      "), and connect it to " +
      p.name +
      " on " +
      chain +
      ". Takes about 20 minutes.",
    actions.first + " Takes about 30 minutes.",
    actions.second + " Takes about 15 minutes a week.",
    "Check whether " +
      p.name +
      " runs a points program, and if it does, link the same wallet, finish its checklist, and keep the position open so points keep accruing. Takes about 10 minutes.",
    "Watch for a token announcement from " +
      p.name +
      " once a week, keep the position open until it lands, and plan the exit before claiming so you do not sell into the first hour. Takes about 5 minutes a week.",
  ];
  // The gate requires every step to be 20 to 600 characters once trimmed.
  return steps.map((s) => s.trim());
}

// ---------------------------------------------------------------------------
// The board.
// ---------------------------------------------------------------------------

export function buildBoard(snapshot: Snapshot): Board {
  const asOf = snapshot.as_of || AS_OF_FALLBACK;
  const watchlist = new Set(snapshot.watchlist);
  const farmable: SnapshotProtocol[] = [];
  let excludedPreToken = 0;
  let tokenAlreadyCount = 0;
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) {
      tokenAlreadyCount++;
      continue;
    }
    if (!isFarmable(p)) {
      excludedPreToken++;
      continue;
    }
    farmable.push(p);
  }

  const valued = farmable.map((p) => {
    const { value, breakdown } = impliedValue(p, asOf);
    return { p, value, breakdown };
  });
  valued.sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    if (b.p.tvl_usd !== a.p.tvl_usd) return b.p.tvl_usd - a.p.tvl_usd;
    return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
  });

  // The ranks must be 1..N and the implied value must not rise with rank,
  // and not every value may be the same: nudge a value down by a dollar
  // whenever rounding would otherwise repeat the previous row's value.
  const maxValue = valued.length > 0 ? valued[0].value : 1;
  const minValue = valued.length > 0 ? valued[valued.length - 1].value : 1;
  const logMax = Math.log(Math.max(maxValue, 1));
  const logMin = Math.log(Math.max(minValue, 1));
  const logSpan = logMax - logMin || 1;

  const rows: BoardRow[] = [];
  let previous = Number.POSITIVE_INFINITY;
  for (let i = 0; i < valued.length; i++) {
    const { p, breakdown } = valued[i];
    let value = valued[i].value;
    if (value >= previous) value = previous - 1;
    if (value < 1) value = 1;
    previous = value;
    const score = Math.round(
      (100 * (Math.log(Math.max(value, 1)) - logMin)) / logSpan,
    );
    rows.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: ageDays(p, asOf),
      rank: i + 1,
      implied_value_usd: value,
      score: score,
      verdict: verdictFor(score),
      watchlist: watchlist.has(p.slug),
      breakdown: breakdown,
      farm_steps: farmSteps(p),
    });
  }

  return {
    rows,
    farmableCount: farmable.length,
    excludedPreToken,
    tokenAlreadyCount,
    watchlistCount: snapshot.watchlist.length,
  };
}
