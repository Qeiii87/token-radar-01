// Token Radar dashboard: renders the board from data.js, filters and sorts
// it, and shows a detail view for every protocol with the farm plan the
// model generates for it. No network: every byte comes from data.js.

(function () {
  var D = window.RADAR;
  if (!D) return;

  function money(v) {
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
    return "$" + v;
  }
  function changeText(c) {
    if (c === null || c === undefined) return "—";
    var s = (c > 0 ? "+" : "") + c.toFixed(1) + "%";
    return s;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Rows arrive compact: [slug, name, categoryIdx, chainIdxs, tvl, change7d,
  // ageDays, impliedValue, score, watchlist, [multiple, growth, age, chain, cat]]
  var rows = D.rows.map(function (r, i) {
    return {
      rank: i + 1,
      slug: r[0],
      name: r[1],
      category: D.categories[r[2]],
      chains: r[3].map(function (ci) { return D.chains[ci]; }),
      tvl: r[4],
      change: r[5],
      age: r[6],
      implied: r[7],
      score: r[8],
      watchlist: r[9] === 1,
      factors: r[10],
    };
  });

  var $ = function (id) { return document.getElementById(id); };
  var state = { q: "", category: "", chain: "", sort: "value", watchlistOnly: false, hideWeak: false, selected: null };

  // Stats bar.
  var top = rows[0];
  $("stats").innerHTML =
    stat(money(top ? top.implied : 0), "Top implied value") +
    stat(String(rows.length), "Protocols ranked") +
    stat(String(D.counts.watchlist), "On the watchlist") +
    stat(String(D.counts.token_already), "Already have a token") +
    stat(D.as_of, "Snapshot date");
  function stat(b, label) {
    return '<div class="stat"><b>' + esc(b) + "</b><span>" + esc(label) + "</span></div>";
  }

  $("excluded").textContent =
    D.counts.token_already +
    " protocols in the snapshot already record a token, and " +
    D.counts.excluded_pre_token +
    " more record none but are not farmable — centralised exchanges, bridges, " +
    "liquid-staking products and wrapped or staked products of tokens that already trade.";

  // Filter options.
  fillSelect($("category"), D.categories);
  fillSelect($("chain"), D.chains);
  function fillSelect(sel, values) {
    values.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v; o.textContent = v; sel.appendChild(o);
    });
  }

  function verdict(score) {
    if (score >= 85) return "Top farm — start here";
    if (score >= 65) return "Strong launch case";
    if (score >= 45) return "Worth farming";
    if (score >= 25) return "Early / speculative";
    return "Weak case — monitor only";
  }

  function filtered() {
    var list = rows.filter(function (r) {
      if (state.watchlistOnly && !r.watchlist) return false;
      if (state.hideWeak && r.score < 25) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      }
      return true;
    });
    var sorters = {
      value: function (a, b) { return b.implied - a.implied; },
      tvl: function (a, b) { return b.tvl - a.tvl; },
      growth: function (a, b) { return (b.change === null ? -1e9 : b.change) - (a.change === null ? -1e9 : a.change); },
      age: function (a, b) { return (b.age === null ? -1 : b.age) - (a.age === null ? -1 : a.age); },
    };
    return list.slice().sort(sorters[state.sort] || sorters.value);
  }

  function render() {
    var list = filtered();
    $("count").textContent = "Showing " + list.length + " of " + rows.length + " ranked protocols.";
    var html = "";
    list.forEach(function (r) {
      var cls = r.change === null ? "" : (r.change >= 0 ? "up" : "down");
      html += '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : "") + ">" +
        '<td class="num">' + r.rank + "</td>" +
        '<td><span class="name">' + esc(r.name) + "</span>" +
        '<span class="slug">' + esc(r.slug) + (r.watchlist ? ' <span class="wl">WATCHLIST</span>' : "") + "</span></td>" +
        "<td>" + esc(r.category) + "</td>" +
        '<td class="num">' + money(r.tvl) + "</td>" +
        '<td class="num ' + cls + '">' + changeText(r.change) + "</td>" +
        '<td class="num">' + money(r.implied) + "</td>" +
        '<td><span class="bar"><i style="width:' + r.score + '%"></i></span>' + r.score + "</td>" +
        "</tr>";
    });
    $("rows").innerHTML = html || '<tr><td colspan="7">No protocols match these filters.</td></tr>';
    var trs = document.querySelectorAll("#rows tr[data-slug]");
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener("click", function () { select(this.getAttribute("data-slug")); });
    }
  }

  // Farm plans: the same five-step plan the model writes into board.json,
  // rebuilt here from the protocol's category, main chain and name.
  var GAS = {
    Ethereum: "about $3 to $15 of gas per transaction on Ethereum",
    Solana: "about $0.01 of gas per transaction on Solana",
    Base: "about $0.05 to $0.50 of gas per transaction on Base",
    Arbitrum: "about $0.05 to $0.50 of gas per transaction on Arbitrum",
    Optimism: "about $0.05 to $0.50 of gas per transaction on Optimism",
    Polygon: "about $0.05 to $0.30 of gas per transaction on Polygon",
    Avalanche: "about $0.10 to $1 of gas per transaction on Avalanche",
    Bitcoin: "about $1 to $5 of fees per transaction on Bitcoin",
  };
  function actions(category, name, chain) {
    var generic = [
      "Use " + name + " on " + chain + " with $100 to $500: make a real deposit or trade, not a dust transaction, so the activity counts.",
      "Come back every week and repeat the same action on " + name + " with a fresh $50 to $200, keeping the position open between visits.",
    ];
    var map = {
      Dexs: [
        "Swap $100 to $500 through " + name + " on " + chain + " across two different tokens, then add $100 to $300 to a liquidity pool and hold the LP position.",
        "Route one swap a week through " + name + " instead of another exchange, and keep the liquidity position open so fees and volume keep accruing.",
      ],
      Lending: [
        "Supply $200 to $1,000 of a stablecoin or blue-chip asset to " + name + " on " + chain + " and leave it earning for at least a month.",
        "Borrow a small amount, $50 to $200, against the supply on " + name + ", repay it after a week, and keep the loan-to-value below 50% the whole time.",
      ],
      "Uncollateralized Lending": [
        "Supply $200 to $1,000 of a stablecoin or blue-chip asset to " + name + " on " + chain + " and leave it earning for at least a month.",
        "Borrow a small amount, $50 to $200, against the supply on " + name + ", repay it after a week, and keep the loan-to-value below 50% the whole time.",
      ],
      Yield: [
        "Deposit $100 to $500 into a " + name + " vault on " + chain + " and let the yield compound there for at least four weeks.",
        "Claim and re-deposit the vault rewards on " + name + " once a week, and move half of any new deposit into a second vault it runs.",
      ],
      "Yield Aggregator": [
        "Deposit $100 to $500 into a " + name + " vault on " + chain + " and let the yield compound there for at least four weeks.",
        "Claim and re-deposit the vault rewards on " + name + " once a week, and move half of any new deposit into a second vault it runs.",
      ],
      Farm: [
        "Deposit $100 to $500 into a " + name + " vault on " + chain + " and let the yield compound there for at least four weeks.",
        "Claim and re-deposit the vault rewards on " + name + " once a week, and move half of any new deposit into a second vault it runs.",
      ],
      Derivatives: [
        "Open a small $50 to $200 position on " + name + " on " + chain + " with low leverage, and close it after a few days with a profit or a planned small loss.",
        "Open one more $50 to $200 position the following week on " + name + ", this time on the opposite side, to build a history of both directions.",
      ],
      "Basis Trading": [
        "Open a small $50 to $200 position on " + name + " on " + chain + " with low leverage, and close it after a few days with a profit or a planned small loss.",
        "Open one more $50 to $200 position the following week on " + name + ", this time on the opposite side, to build a history of both directions.",
      ],
      "Interest Rate Derivatives": [
        "Open a small $50 to $200 position on " + name + " on " + chain + " with low leverage, and close it after a few days with a profit or a planned small loss.",
        "Open one more $50 to $200 position the following week on " + name + ", this time on the opposite side, to build a history of both directions.",
      ],
      "Options Vault": [
        "Open a small $50 to $200 position on " + name + " on " + chain + " with low leverage, and close it after a few days with a profit or a planned small loss.",
        "Open one more $50 to $200 position the following week on " + name + ", this time on the opposite side, to build a history of both directions.",
      ],
      CDP: [
        "Lock $200 to $1,000 of collateral in " + name + " on " + chain + " and mint $50 to $300 of its stablecoin, keeping collateral above 200%.",
        "Use the minted stablecoin for a real payment or swap on " + chain + ", then repay part of the loan and top the collateral up the next week.",
      ],
      "CDP Manager": [
        "Lock $200 to $1,000 of collateral in " + name + " on " + chain + " and mint $50 to $300 of its stablecoin, keeping collateral above 200%.",
        "Use the minted stablecoin for a real payment or swap on " + chain + ", then repay part of the loan and top the collateral up the next week.",
      ],
      "Dual-Token Stablecoin": [
        "Lock $200 to $1,000 of collateral in " + name + " on " + chain + " and mint $50 to $300 of its stablecoin, keeping collateral above 200%.",
        "Use the minted stablecoin for a real payment or swap on " + chain + ", then repay part of the loan and top the collateral up the next week.",
      ],
      RWA: [
        "Buy $100 to $500 of a tokenised real-world asset on " + name + " on " + chain + " and hold it for at least a month to show long-term use.",
        "Collect the yield or payout the asset pays on " + name + ", reinvest half of it, and add a second $50 to $200 purchase the following month.",
      ],
      "Risk Curators": [
        "Allocate $200 to $1,000 to a vault curated by " + name + " on " + chain + " and keep the allocation in place for at least a month.",
        "Review the vault's allocation on " + name + " once a week, move $50 to $200 between its vaults once, and keep a record of every move.",
      ],
      "Onchain Capital Allocator": [
        "Allocate $200 to $1,000 to a vault curated by " + name + " on " + chain + " and keep the allocation in place for at least a month.",
        "Review the vault's allocation on " + name + " once a week, move $50 to $200 between its vaults once, and keep a record of every move.",
      ],
      "Liquidity Manager": [
        "Allocate $200 to $1,000 to a vault curated by " + name + " on " + chain + " and keep the allocation in place for at least a month.",
        "Review the vault's allocation on " + name + " once a week, move $50 to $200 between its vaults once, and keep a record of every move.",
      ],
      "Prediction Market": [
        "Trade $20 to $100 on a live market on " + name + " on " + chain + ", on an outcome you have actually researched, and hold it to resolution.",
        "Trade a second $20 to $100 market on " + name + " the next week, and add liquidity to one market if it offers a liquidity pool.",
      ],
      "Leveraged Farming": [
        "Open a $100 to $300 leveraged farming position on " + name + " on " + chain + " at no more than 2x, and monitor the health factor daily for the first week.",
        "Close half the position on " + name + " after two weeks, take the profit or cut the loss, and leave the rest running.",
      ],
    };
    return map[category] || generic;
  }
  function farmSteps(r) {
    var chain = r.chains.length ? r.chains[0] : "Ethereum";
    var a = actions(r.category, r.name, chain);
    var gas = GAS[chain] || "about $0.10 to $1 of gas per transaction";
    return [
      "Set up a fresh wallet for farming, fund it with $100 to $500 plus gas money (" + gas + "), and connect it to " + r.name + " on " + chain + ". Takes about 20 minutes.",
      a[0] + " Takes about 30 minutes.",
      a[1] + " Takes about 15 minutes a week.",
      "Check whether " + r.name + " runs a points program, and if it does, link the same wallet, finish its checklist, and keep the position open so points keep accruing. Takes about 10 minutes.",
      "Watch for a token announcement from " + r.name + " once a week, keep the position open until it lands, and plan the exit before claiming so you do not sell into the first hour. Takes about 5 minutes a week.",
    ];
  }

  function select(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) r = rows[i];
    if (!r) return;
    state.selected = slug;
    var f = r.factors;
    var steps = farmSteps(r).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    $("detail").innerHTML =
      '<span class="verdict">' + esc(verdict(r.score)) + "</span>" +
      "<h2>" + esc(r.name) + "</h2>" +
      '<p class="sub">Rank #' + r.rank + " · " + esc(r.category) + " · " + esc(r.chains.join(", ")) +
      (r.watchlist ? " · On the watchlist" : "") + "</p>" +
      '<div class="kv">' +
      "<div><b>" + money(r.implied) + "</b><span>Implied value</span></div>" +
      "<div><b>" + money(r.tvl) + "</b><span>TVL</span></div>" +
      "<div><b>" + changeText(r.change) + "</b><span>7-day TVL change</span></div>" +
      "<div><b>" + (r.age === null ? "Unknown" : r.age + " days") + "</b><span>Age with no token</span></div>" +
      "</div>" +
      "<h3>Why it ranks here</h3>" +
      '<p class="why">Implied value = TVL × 2 × growth ' + f[1] + " × age " + f[2] +
      " × reach " + f[3] + " × category " + f[4] + " = " + f[0] +
      "× TVL. The protocol records no token: DefiLlama lists neither a CoinGecko id nor a ticker for it.</p>" +
      "<h3>How to farm it — 5 steps</h3><ol>" + steps + "</ol>";
    if (location.hash !== "#detail=" + slug) history.replaceState(null, "", "#detail=" + slug);
    render();
  }

  $("q").addEventListener("input", function () { state.q = this.value; render(); });
  $("category").addEventListener("change", function () { state.category = this.value; render(); });
  $("chain").addEventListener("change", function () { state.chain = this.value; render(); });
  $("sort").addEventListener("change", function () { state.sort = this.value; render(); });
  $("watchlistOnly").addEventListener("change", function () { state.watchlistOnly = this.checked; render(); });
  $("hideWeak").addEventListener("change", function () { state.hideWeak = this.checked; render(); });

  // Deep links: #detail=<slug> opens a detail view, #watchlist=1 filters.
  var hash = location.hash || "";
  if (hash.indexOf("#detail=") === 0) {
    select(decodeURIComponent(hash.slice(8)));
  } else {
    if (hash.indexOf("watchlist=1") !== -1) {
      state.watchlistOnly = true;
      $("watchlistOnly").checked = true;
    }
    render();
  }
})();
