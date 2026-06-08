import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { color } from './theme.js';

export function CommandBar({
  onSubmit,
  onTyping,
  interactive,
}: {
  onSubmit:    (v: string) => void;
  onTyping:    (t: boolean) => void;
  interactive: boolean;
}) {
  const [query, setQuery] = useState('');

  return (
    <Box
      borderStyle="single"
      borderColor={query.length > 0 ? color.amberHi : color.amberDim}
      paddingX={2}
      width="100%"
    >
      <Text color={color.greenHi} bold>❯ </Text>
      {interactive ? (
        <TextInput
          value={query}
          onChange={(val) => {
            setQuery(val);
            onTyping(val.length > 0);
          }}
          onSubmit={(val) => {
            const trimmed = val.trim();
            setQuery('');
            onTyping(false);
            if (trimmed) onSubmit(trimmed);
          }}
          placeholder="type a command…"
        />
      ) : (
        <Text color={color.textFaint}>groundhog &lt;command&gt;</Text>
      )}
    </Box>
  );
}
