// api/nutrition-calc.js
// Minimaler Express-Server mit / (Healthcheck) und /calculate (OpenAI-gestützt)

const express = require('express');
const app = express();

// --- CORS (optional, hilfreich für Tests aus Browser/Flutter) ---
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');                // ggf. Domain statt *
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// --- Healthcheck ---
app.get('/', (_req, res) => {
  res.json({ ok: true, name: 'nutrition-api', version: '1.0.0' });
});

// --- /calculate: ermittelt kcal/100g via OpenAI und berechnet benötigte Gramm ---
app.post('/calculate', async (req, res) => {
  try {
    const { food, targetKcal } = req.body || {};
    const f = String(food || '').trim();
    const t = Number(targetKcal || 0);

    if (!f || !isFinite(t) || t <= 0) {
      return res.status(400).json({ error: "Provide 'food' and 'targetKcal' > 0" });
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    // Prompt: NUR kompaktes JSON zurückgeben
    const body = {
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a nutrition assistant. Estimate realistic calories per 100g for a given common food (no brands). If ambiguous, assume the most common preparation. Return ONLY compact JSON."
        },
        {
          role: "user",
          content: `Food: ${f}\nReturn JSON with key: kcal_per_100g (number).`
        }
      ]
    };

    // Node 18+ hat fetch global; Node 22 passt.
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return res.status(500).json({ error: `OpenAI ${r.status}: ${txt}` });
    }

    const json = await r.json();
    const content = json?.choices?.[0]?.message?.content ?? "{}";

    // OpenAI soll pures JSON liefern – hier parsen
    let parsed = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      return res.status(500).json({ error: "openai_invalid_json", raw: content });
    }

    const per100 = Number(parsed.kcal_per_100g);
    if (!isFinite(per100) || per100 <= 0) {
      return res.status(500).json({ error: "Invalid kcal_per_100g" });
    }

    // grams = kcal * (100 / kcal_per_100g)
    const grams = t * (100 / per100);

    return res.status(200).json({
      food: f,
      targetKcal: t,
      kcal_per_100g: Number(per100.toFixed(1)),
      grams_for_target: Number(grams.toFixed(1)),
      explanation: `≈ ${grams.toFixed(0)} g ${f} to reach ${t} kcal at ~${per100.toFixed(0)} kcal/100g.`
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// --- Server starten (Render setzt PORT in env) ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on ${PORT}`));
