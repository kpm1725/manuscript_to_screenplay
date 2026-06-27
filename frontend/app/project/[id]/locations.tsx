import { useLocalSearchParams } from "expo-router";
import ResourceList from "@/src/components/ResourceList";

export default function Locations() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ResourceList
      projectId={id!}
      resource="locations"
      title="Locations"
      iconName="location-outline"
      emptyHint="No locations yet. Map the world your story lives in."
      fields={[
        { key: "name", label: "Name", placeholder: "Coffee shop, Apartment, Forest…", primary: true },
        { key: "int_ext", label: "INT / EXT", placeholder: "INT or EXT", secondary: true },
        { key: "time_of_day", label: "Time of Day", placeholder: "DAY, NIGHT, DUSK…" },
        { key: "description", label: "Description", placeholder: "Mood, layout, sensory details", multiline: true, body: true },
      ]}
    />
  );
}
