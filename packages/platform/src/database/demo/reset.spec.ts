import { describe, expect, it } from 'vitest';

import { planCascade } from './reset.js';

describe('fn:planCascade', () => {
  it('should delete grandchildren before children before the root', () => {
    const edges = [
      {
        child: 'media_assets',
        childColumns: ['record_id'],
        parent: 'records',
        parentColumns: ['id'],
      },
      {
        child: 'media_derivatives',
        childColumns: ['original_asset_id'],
        parent: 'media_assets',
        parentColumns: ['id'],
      },
    ];

    expect(
      planCascade(edges, { table: 'records', condition: 'owner_id = $1' }),
    ).toEqual([
      {
        table: 'media_derivatives',
        condition:
          '("original_asset_id") in (select "id" from "media_assets" where ("record_id") in (select "id" from "records" where owner_id = $1))',
      },
      {
        table: 'media_assets',
        condition:
          '("record_id") in (select "id" from "records" where owner_id = $1)',
      },
      { table: 'records', condition: 'owner_id = $1' },
    ]);
  });

  it('should bind the root parameters in every deletion under it', () => {
    const jobIds = ['00000000-0000-4000-8000-000000000001'];
    const edges = [
      {
        child: 'job_events',
        childColumns: ['job_id'],
        parent: 'jobs',
        parentColumns: ['id'],
      },
    ];

    expect(
      planCascade(edges, {
        table: 'jobs',
        condition: 'owner_id = $1 and id = any($2::uuid[])',
        parameters: [jobIds],
      }).map((target) => target.parameters),
    ).toEqual([[jobIds], [jobIds]]);
  });

  it('should stop at a table already on the branch instead of looping', () => {
    const edges = [
      {
        child: 'topics',
        childColumns: ['parent_id'],
        parent: 'topics',
        parentColumns: ['id'],
      },
    ];

    expect(
      planCascade(edges, { table: 'topics', condition: 'owner_id = $1' }),
    ).toEqual([{ table: 'topics', condition: 'owner_id = $1' }]);
  });
});
