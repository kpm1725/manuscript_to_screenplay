import { useLocalSearchParams } from "expo-router";
import ResourceList from "@/src/components/ResourceList";

export default function Scenes() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ResourceList
      projectId={id!}
      resource="scenes"
      title="Scene Board"
      iconName="grid-outline"
      emptyHint="No scenes yet. Add the inciting incident to begin."
      fields={[
        { key: "title", label: "Scene Title", placeholder: "What happens in this scene", primary: true },
        { key: "location", label: "Location", placeholder: "Where it takes place", secondary: true },
        { key: "summary", label: "Summary", placeholder: "Beats and turns", multiline: true, body: true },
        { key: "characters", label: "Characters", placeholder: "Who appears" },
        { key: "status", label: "Status", placeholder: "draft, written, polished" },
      ]}
    />
  );
}
