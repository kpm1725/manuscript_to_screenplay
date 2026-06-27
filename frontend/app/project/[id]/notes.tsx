import { useLocalSearchParams } from "expo-router";
import ResourceList from "@/src/components/ResourceList";

export default function Notes() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ResourceList
      projectId={id!}
      resource="notes"
      title="Notes & Research"
      iconName="bookmark-outline"
      emptyHint="No notes yet. Capture ideas before they vanish."
      fields={[
        { key: "title", label: "Title", placeholder: "Note title", primary: true },
        { key: "tag", label: "Tag", placeholder: "research, inspiration, dialogue", secondary: true },
        { key: "body", label: "Body", placeholder: "Write your thoughts…", multiline: true, body: true },
      ]}
    />
  );
}
