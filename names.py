import time
import pandas as pd
import requests

# 1. Read metadata file and extract unique species including primary_label
df = pd.read_csv("train_metadata.csv")
species_df = (
    df[["primary_label", "scientific_name", "common_name"]]
    .drop_duplicates()
    .reset_index(drop=True)
)
species_df.rename(columns={"common_name": "english_name"}, inplace=True)

print(f"Found {len(species_df)} unique species.")


# 2. Function to fetch Swedish names from Wikidata via SPARQL
def fetch_swedish_names_batch(scientific_names):
    url = "https://query.wikidata.org/sparql"

    formatted_names = " ".join([f'"{name}"' for name in scientific_names])

    query = f"""
    SELECT ?sciName ?sweLabel WHERE {{
      VALUES ?sciName {{ {formatted_names} }}
      ?taxon wdt:P225 ?sciName .
      ?taxon rdfs:label ?sweLabel .
      FILTER(LANG(?sweLabel) = "sv")
    }}
    """

    headers = {"User-Agent": "BirdNameApp/1.0 (contact@example.com)"}

    try:
        response = requests.get(
            url, params={"format": "json", "query": query}, headers=headers, timeout=15
        )
        data = response.json()

        mapping = {}
        for result in data["results"]["bindings"]:
            sci = result["sciName"]["value"].strip()
            swe = result["sweLabel"]["value"].strip()
            mapping[sci.lower()] = swe

        return mapping
    except Exception as e:
        print(f"An error occurred for this batch: {e}")
        return {}


# 3. Fetch Swedish names in batches
sci_list = species_df["scientific_name"].tolist()
batch_size = 50
swe_map = {}

print("Fetching Swedish names from Wikidata in batches...")
for i in range(0, len(sci_list), batch_size):
    batch = sci_list[i : i + batch_size]
    print(f"Fetching batch {i // batch_size + 1} ({len(batch)} species)...")

    batch_map = fetch_swedish_names_batch(batch)
    swe_map.update(batch_map)

    time.sleep(0.5)  # Rate limiting delay to respect server limits

# 4. Map Swedish names back to the dataframe
species_df["swedish_name"] = species_df["scientific_name"].apply(
    lambda name: swe_map.get(name.strip().lower(), None)
)

# 5. Manual fallback for missing entries or known exceptions (e.g., lesred1 / Lesser Redpoll)
manual_corrections = {"lesred1": "brunsiska"}

for label, swe_name in manual_corrections.items():
    species_df.loc[
        (species_df["primary_label"] == label)
        & (species_df["swedish_name"].isna()),
        "swedish_name",
    ] = swe_name

# 6. Check results and save
found_count = species_df["swedish_name"].notna().sum()
missing_df = species_df[species_df["swedish_name"].isna()]

print(f"\nDone! Found {found_count} out of {len(species_df)} Swedish names.")

if len(missing_df) > 0:
    print(f"\nThe following {len(missing_df)} species are still missing a Swedish name:")
    print(missing_df[["primary_label", "scientific_name", "english_name"]])

# Save to CSV with primary_label as the first column
species_df.to_csv("bird_names_dictionary.csv", index=False, encoding="utf-8-sig")
print("\nFile saved successfully as 'bird_names_dictionary.csv'!")