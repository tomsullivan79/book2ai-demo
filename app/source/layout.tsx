import { Suspense } from 'react';
import DeepLinker from './DeepLinker';

export default function SourceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <DeepLinker />
      </Suspense>
      {children}
    </>
  );
}
