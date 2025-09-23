'use client';

import React from 'react';
import DeepLinker from './DeepLinker';

export default function SourceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DeepLinker />
      {children}
    </>
  );
}
