import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TextField } from './index.js';

it('should label a field and deliver edits to a controlled consumer', async () => {
  const change = jest.fn();
  const view = await render(
    <TextField
      label="Collector note"
      value="Initial note"
      onChangeText={change}
      multiline
    />,
  );
  expect(screen.getByLabelText('Collector note')).toHaveDisplayValue(
    'Initial note',
  );

  await fireEvent.changeText(
    screen.getByLabelText('Collector note'),
    'Updated note',
  );
  expect(change).toHaveBeenCalledWith('Updated note');
  await view.rerender(
    <TextField
      label="Collector note"
      value="Updated note"
      onChangeText={change}
      multiline
    />,
  );
  expect(screen.getByLabelText('Collector note')).toHaveDisplayValue(
    'Updated note',
  );
});

it('should retain a read-only field value when editing is disabled', async () => {
  const change = jest.fn();
  await render(
    <TextField
      label="Record code"
      value="A-001"
      onChangeText={change}
      editable={false}
    />,
  );

  await fireEvent.changeText(screen.getByLabelText('Record code'), 'A-002');
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Record code')).toHaveDisplayValue('A-001');
});
