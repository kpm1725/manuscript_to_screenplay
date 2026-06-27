import { useLocalSearchParams } from "expo-router";
import ResourceList from "@/src/components/ResourceList";

export default function Characters() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ResourceList
      projectId={id!}
      resource="characters"
      title="Character Bible"
      iconName="people-outline"
      emptyHint="No characters yet. Begin with your protagonist."
      fields={[
        { key: "name", label: "Name", placeholder: "Character name", primary: true },
        { key: "role", label: "Role", placeholder: "Protagonist, antagonist, mentor…", secondary: true },
        { key: "description", label: "Description", placeholder: "Physical and behavioral details", multiline: true, body: true },
        { key: "arc", label: "Arc", placeholder: "Transformation across the story", multiline: true },
        { key: "traits", label: "Traits", placeholder: "Habits, quirks, flaws", multiline: true },
      ]}
    />
  );
}
