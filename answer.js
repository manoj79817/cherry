const express = require("express");
const app = express();
app.use(express.json());

app.post("/v1/answer", async (req, res) => {
  const { query } = req.body;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=YOUR_GEMINI_API_KEY_HERE`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }]
      })
    }
  );
  const data = await response.json();
  const output = data.candidates[0].content.parts[0].text;
  res.json({ output });
});

app.listen(3000, () => console.log("✅ Server running on port 3000"));