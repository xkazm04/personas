#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-3.1-flash-image-preview';

async function removeBackground(inputPath, outputPath) {
  const absInput = resolve(inputPath);
  const imageData = readFileSync(absInput).toString('base64');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

  const body = {
    contents: [{
      parts: [
        { inlineData: { mimeType: 'image/png', data: imageData } },
        { text: 'Remove the background from this image. Keep only the central object. Return the result as an IMAGE.' }
      ]
    }],
    generationConfig: {
      responseModalities: ['IMAGE']
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  const outputImage = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;

  if (outputImage) {
    writeFileSync(resolve(outputPath), Buffer.from(outputImage.data, 'base64'));
    console.log(JSON.stringify({ success: true, output: outputPath }));
  } else {
    console.error(JSON.stringify({ error: 'Background removal failed', details: data }));
  }
}

removeBackground(process.argv[2], process.argv[3]);
