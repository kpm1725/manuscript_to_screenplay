import { useLocalSearchParams } from "expo-router";
import ResourceList from "@/src/components/ResourceList";

export default function Beats() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ResourceList
      projectId={id!}
      resource="beats"
      title="Plot Timeline"
      iconName="git-branch-outline"
      emptyHint="No beats charted yet. Sketch the spine of your story."
      fields={[
        { key: "title", label: "Beat Title", placeholder: "Inciting incident, midpoint, climax…", primary: true },
        { key: "act", label: "Act", placeholder: "I, II, III", secondary: true },
        { key: "summary", label: "Summary", placeholder: "What happens in this beat", multiline: true, body: true },
      ]}
    />
  );
}
