import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { centeredWindow, coverCrop, renderAnglePhoto } from './photos.js';

const frame = { widthPx: 400, heightPx: 300 };

describe('fn:coverCrop', () => {
  it('should fill the frame and offset the crop by the object-position share of the overflow', () => {
    expect(
      coverCrop({ widthPx: 200, heightPx: 200 }, frame, { x: 0.5, y: 0.85 }),
    ).toEqual({
      resizedWidth: 400,
      resizedHeight: 400,
      left: 0,
      top: 85,
      width: 400,
      height: 300,
    });
  });
});

describe('fn:centeredWindow', () => {
  it('should clip an element larger than the frame around its center', () => {
    expect(centeredWindow({ widthPx: 800, heightPx: 600 }, frame)).toEqual({
      source: { left: 200, top: 150, width: 400, height: 300 },
      offset: { left: 0, top: 0 },
    });
  });

  it('should letterbox a rotated element narrower than the frame', () => {
    expect(centeredWindow({ widthPx: 360, heightPx: 480 }, frame)).toEqual({
      source: { left: 0, top: 90, width: 360, height: 300 },
      offset: { left: 20, top: 0 },
    });
  });
});

describe('fn:renderAnglePhoto', () => {
  it('should render a rotated and scaled angle at the frame size', async () => {
    const source = await sharp({
      create: {
        width: 90,
        height: 60,
        channels: 3,
        background: { r: 200, g: 120, b: 40 },
      },
    })
      .jpeg()
      .toBuffer();

    const photo = await renderAnglePhoto(
      source,
      { label: '背面', scale: 1.2, rotation: 'quarter' },
      frame,
    );

    expect(await sharp(photo).metadata()).toMatchObject({
      format: 'jpeg',
      width: 400,
      height: 300,
    });
  });
});
