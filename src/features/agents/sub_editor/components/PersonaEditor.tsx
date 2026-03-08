import { EditorDirtyProvider } from '../libs/EditorDocument';
import { EditorBody } from './EditorBody';

export default function PersonaEditor() {
  return (
    <EditorDirtyProvider>
      <EditorBody />
    </EditorDirtyProvider>
  );
}
