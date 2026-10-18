import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import RecordRoute from '../../../app/(private)/collection/[recordId]';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

import { observationId } from './record.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
      useLocalSearchParams:
        jest.fn<typeof import('expo-router').useLocalSearchParams>(),
    }) satisfies Partial<typeof import('expo-router')>,
);

const sectionY = 900;
const observationY = 300;
const contentGap = 24;
const relaidSectionY = 1000;

/**
 * returns the record and its observations, with no media or references
 * @param path requested API path
 * @returns response body for the requested record endpoint
 */
async function reads(path: string): Promise<unknown> {
  if (path === `/v1/records/${collectionRecord.id}`) {
    return collectionRecord;
  }
  if (path.endsWith('/observations')) {
    return {
      items: [{ id: observationId, text: 'Blue decoration' }],
      nextCursor: null,
    };
  }

  return { items: [], nextCursor: null };
}

/**
 * lays out the element, or its nearest ancestor that listens for layout
 * @param element element that receives the layout event
 * @param y vertical offset inside its parent
 */
async function layOut(
  element: ReturnType<typeof screen.getByText>,
  y: number,
): Promise<void> {
  await fireEvent(element, 'layout', {
    nativeEvent: { layout: { x: 0, y, width: 320, height: 120 } },
  });
}

it('should scroll once to the referenced observation after both it and its section are laid out', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    observationId,
  });
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  await renderMobile(<RecordRoute />, { get: reads });
  const observation = await screen.findByLabelText(
    'Referenced observation: Blue decoration',
  );
  const section = screen.getByText('Collector observations');

  await layOut(section, sectionY);
  expect(scrollTo).not.toHaveBeenCalled();
  await layOut(observation, observationY);
  await waitFor(() =>
    expect(scrollTo).toHaveBeenCalledWith({
      y: sectionY + observationY - contentGap,
      animated: false,
    }),
  );
  await layOut(section, relaidSectionY);
  expect(scrollTo).toHaveBeenCalledTimes(1);
});

it('should not scroll when the record is opened without a referenced observation', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
  });
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  await renderMobile(<RecordRoute />, { get: reads });
  await screen.findByText('Blue decoration');

  await layOut(screen.getByText('Collector observations'), sectionY);

  expect(scrollTo).not.toHaveBeenCalled();
});
