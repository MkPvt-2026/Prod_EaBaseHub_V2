export async function uploadClaimMedia(files, supabaseClient){

  const urls = [];

  for(const file of files){

    const fileName = Date.now() + "_" + file.name;

    const { error } = await supabaseClient
      .storage
      .from("claim-media")
      .upload(fileName, file);

    if(error){
      console.error("Upload error:", error);
      continue;
    }

    const { data } = supabaseClient
      .storage
      .from("claim-media")
      .getPublicUrl(fileName);

    urls.push(data.publicUrl);

  }

  return urls;

}