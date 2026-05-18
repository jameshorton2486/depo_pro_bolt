// ============================================================================
// App.tsx — local-first simple version
// ----------------------------------------------------------------------------
// This replaces the original App.tsx for the simplified local-first build.
// All the original components (CaseIntake, TemplateConfig, JobDashboard,
// TranscribeEngine) still exist on disk untouched — you just don't import
// them. To switch back, restore the original src/App.tsx from your bolt
// project's version history.
// ============================================================================

import SimpleTranscribe from './components/SimpleTranscribe';

export default function App() {
  return <SimpleTranscribe />;
}
