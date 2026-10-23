// Built-in house styles: one consistent look (colours, light, style, effects) for a whole game.
export const BUILTIN_HOUSE_STYLES = {
  storybook: {
    description: 'Warm, friendly and soft: like a picture book',
    palette: ['#2b2121', '#5a3a32', '#8c5a3c', '#c98b53', '#f0c27a', '#fbe8c0', '#7da452', '#4a7340', '#6aa3b8', '#3e6a8a', '#c25a4a', '#e7a3a0', '#9a8fb5', '#f7f3e8'],
    lighting: 'product', exposure: 1.05, style: 'realistic', effects: { ao: true, aoStrength: 1.2, bloom: true, bloomStrength: 0.5 },
  },
  dark_fantasy: {
    description: 'Moody and grim: cold light, muted colours, bold outlines',
    palette: ['#0d0b12', '#221d2b', '#3a3343', '#5a5160', '#857a86', '#b8aeb4', '#4a2c2a', '#7a3b2e', '#a85a32', '#2f4a3a', '#4f6e4a', '#2c3f5e', '#5c7aa3', '#c7b26a'],
    lighting: 'night', exposure: 1.15, style: 'toon', styleOptions: { outlineWidth: 1.4, outlineColor: '#0d0b12', toonSteps: 3 }, effects: { ao: false, bloom: true, bloomStrength: 0.9 },
  },
  retro_pixel: {
    description: 'Bright arcade look built on the PICO-8 palette',
    palette: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
    lighting: 'studio', exposure: 1.1, style: 'lowpoly', effects: { ao: true, aoStrength: 0.8, bloom: true, bloomStrength: 0.6 },
  },
};
