import sharp from 'sharp'
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M64 6 L116 20 V60 C116 92 94 112 64 122 C34 112 12 92 12 60 V20 Z" fill="#C60000" stroke="#000" stroke-width="6"/><text x="64" y="76" font-family="DejaVu Sans, Arial, sans-serif" font-weight="700" font-size="34" text-anchor="middle" fill="#fff">FLA</text></svg>`
const buf = await sharp(Buffer.from(svg)).png().toBuffer()
const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true })
let white = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 240 && data[i+1] > 240 && data[i+2] > 240 && data[i+3] > 200) white++
console.log(info, 'white px', white, sharp.versions)
