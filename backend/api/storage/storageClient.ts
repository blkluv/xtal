import { createClient, SupabaseClient } from "@supabase/supabase-js"
import dayjs from "dayjs"
// https://supabase.com/docs/reference/javascript/typescript-support
import { Database } from "../supabase/databaseTypes/supabase.js"
import logger from "../../logger.js"

// Create singleton for the supabase client
let instance: StorageClient

class StorageClient {
  private supabase: SupabaseClient<Database, "public", any>

  constructor() {
    if (instance) {
      throw new Error("Unable to create multiple StorageClient instances")
    }
    if (process.env.SUPABASE_PROJECT_URL == null) {
      throw new Error(
        "Invalid null environment variable 'SUPABASE_PROJECT_URL'"
      )
    }
    if (process.env.SUPABASE_PROJECT_SERVICE_ROLE_API_KEY == null) {
      throw new Error(
        "Invalid null environment variable 'SUPABASE_PROJECT_SERVICE_ROLE_API_KEY'"
      )
    }
    const supabase = createClient<Database>(
      process.env.SUPABASE_PROJECT_URL,
      process.env.SUPABASE_PROJECT_SERVICE_ROLE_API_KEY
    )
    this.supabase = supabase
    instance = this
  }

  getInstance() {
    return this
  }

  private decode(base64FileData: string) {
    return Buffer.from(base64FileData, "base64")
  }

  async uploadFileAndUpdateDatabase({
    base64FileData,
    fileName,
    width,
    height,
    contentType,
    url,
  }: {
    base64FileData: string
    fileName: string
    width: number
    height: number
    contentType: string
    url: string
  }) {
    // https://supabase.com/docs/reference/javascript/storage-from-upload
    const filePath = `public/w${width}_h${height}/${fileName}`
    const uploadFilePromise = this.supabase.storage
      .from("podcast-image") // bucket name
      .upload(filePath, this.decode(base64FileData), {
        contentType: contentType, // e.g. MIME Type "image/webp"
      })
    const insertDatabasePromise = this.supabase
      .from("podcast_images") // database name
      .insert({
        image_width_image_height_url: `w${width}_h${height}_${url}`,
        storage_file_name: fileName,
      })
    const promises = await Promise.allSettled([
      uploadFilePromise,
      insertDatabasePromise,
    ])
    const deleteOperationsBasedOnPromises = [
      async () => {
        try {
          await this.deleteImageStorage([filePath])
        } catch (error: any) {
          logger.error(
            `uploadFileAndUpdateDatabase(): could not delete upload file. image url ${url}, storage file path: ${filePath}`
          )
        }
      },
      async () => {
        const key = `w${width}_h${height}_${url}`
        try {
          await this.deleteImageDatabaseRows([key])
        } catch (error: any) {
          logger.error(
            `uploadFileAndUpdateDatabase(): Delete row ${key} error: ${error.message}`
          )
        }
      },
    ]
    if (promises.some((p) => p.status === "rejected")) {
      for (let i = 0; i < promises.length; i++) {
        const p = promises[i]
        // if any promise has "status": "rejected", we need to perform a delete for those that were fulfilled
        if (p.status === "fulfilled") {
          logger.error(
            `uploadFileAndUpdateDatabase(): attempt to delete for index ${i}. image url: ${url}, width: ${width}, height: ${height}`
          )
          await deleteOperationsBasedOnPromises[i]()
        }
      }
    }
  }

  getFilePublicUrl(fileName: string, width: number, height: number): string {
    // https://supabase.com/docs/reference/javascript/storage-from-getpublicurl
    // does not check if file path is valid
    const { data } = this.supabase.storage
      .from("podcast-image") // bucket name
      .getPublicUrl(`public/w${width}_h${height}/${fileName}`)
    return data.publicUrl
  }

  async getExistingFile(
    url: string,
    width: number,
    height: number
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("podcast_images") // database table
      .select("storage_file_name") // columns to return in data
      .eq("image_width_image_height_url", `w${width}_h${height}_${url}`)
      .limit(1)
    if (data == null || error) {
      return null
    }
    if (data[0] && data[0].storage_file_name) {
      return data[0].storage_file_name
    }
    return null
  }

  async deleteStorageFilesBefore(deleteBeforeDate: Date, limit: number) {
    const deleteBeforeDateString = dayjs(deleteBeforeDate).format("YYYY-MM-DD")
    const { data, error } = await this.supabase
      .from("podcast_images") // database table
      .select("image_width_image_height_url, storage_file_name") // columns to return in data
      .lt("created_at", deleteBeforeDateString) // date format yyyy-mm-dd
      .limit(limit)
    if (error) {
      throw new Error(
        `deleteStorageFilesBefore(): could not get entries to delete, deleteBeforeDate: ${deleteBeforeDateString}. Error: ${error?.details}`
      )
    }
    const deleteDataSize = data.length
    if (deleteDataSize === 0) {
      logger.info("deleteStorageFilesBefore(): zero entries found")
      return
    }
    const chunkSize = 50
    const totalChunks = Math.ceil(deleteDataSize / chunkSize)
    const widthHeightRegex = new RegExp(/^(w\d+_h\d+)_/) // extract width and height from the database primary key
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize
      const end = start + chunkSize
      const deleteChunk = data.slice(start, end)
      const filePaths = deleteChunk.map((data) => {
        const matches =
          data.image_width_image_height_url.match(widthHeightRegex)
        return `public/${matches[1]}/${data.storage_file_name}`
      })
      const imageKeys = deleteChunk.map(
        (data) => data.image_width_image_height_url
      )
      let deletedFileNames: string[] = []
      try {
        const deletedFilePaths = await this.deleteImageStorage(filePaths)
        if (!deletedFilePaths) {
          continue
        }
        // convert from e.g public/w300_h300/yAl3PRi5tDcd1Bfo6x4mv.webp to yAl3PRi5tDcd1Bfo6x4mv.webp
        const fileNameRegex = new RegExp(/^public\/w\d+_h\d+\/(.+)$/)
        deletedFileNames = deletedFilePaths
          .map((d) => {
            const matches = d.match(fileNameRegex)
            const fileName = matches ? matches[1] : null
            return fileName
          })
          .filter((d) => d != null)
      } catch (error: any) {
        logger.error(
          `deleteStorageFilesBefore(): Failed to delete image files. Start Index: ${start}, End Index: ${end} Error: ${
            error.message
          }. Image file Paths: ${JSON.stringify(filePaths)}`
        )
        continue // do not proceed if image deletion has failed, leave the database row intact
      }
      logger.info(
        `deleteStorageFilesBefore(): attempting to delete files from database: ${deletedFileNames}`
      )
      try {
        await this.deleteImageDatabaseRowsWithStorageFileName(deletedFileNames)
      } catch (error: any) {
        logger.error(
          `deleteStorageFilesBefore(): Failed to delete image database rows. Start Index: ${start}, End Index: ${end} Error: ${
            error.message
          }. Database rows: ${JSON.stringify(imageKeys)}`
        )
      }
      // sleep after deleting a chunk
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }

  private async deleteImageDatabaseRowsWithStorageFileName(
    storageFileNames: string[]
  ) {
    if (storageFileNames == null || storageFileNames.length === 0) {
      return
    }
    const { status, error } = await this.supabase
      .from("podcast_images")
      .delete()
      .in("storage_file_name", storageFileNames)
    if (error) {
      throw new Error(
        `deleteImageDatabaseRowsWithStorageFileName(): could not delete ${JSON.stringify(
          storageFileNames
        )}. Status: ${status}. Error: ${error?.message}`
      )
    }
  }

  private async deleteImageDatabaseRows(imageKeys: string[]): Promise<void> {
    if (imageKeys == null || imageKeys.length === 0) {
      return
    }
    const { status, error } = await this.supabase
      .from("podcast_images")
      .delete()
      .in("image_width_image_height_url", imageKeys)
    if (error) {
      throw new Error(
        `deleteImageDatabaseRows(): could not delete ${JSON.stringify(
          imageKeys
        )}. Status: ${status}. Error: ${error?.message}`
      )
    }
  }

  private async deleteImageStorage(
    filePaths: string[]
  ): Promise<string[] | undefined> {
    if (filePaths == null || filePaths.length === 0) {
      return
    }
    const { data, error } = await this.supabase.storage
      .from("podcast-image") // bucket name
      .remove(filePaths)
    if (error) {
      throw new Error(`deleteImageStorage(): Error: ${error.message}`)
    }
    if (data) {
      const deletedFilePaths = data.map((d) => d.name)
      const deletedFilesSet = new Set(deletedFilePaths)
      const missingDeleteFiles = filePaths.filter(
        (p) => !deletedFilesSet.has(p)
      )
      logger.error(
        `deleteImageStorage(): could not delete file paths: ${missingDeleteFiles}`
      )
      return deletedFilePaths
    }
  }
}

const singletonStorageClient = Object.freeze(new StorageClient())
export default singletonStorageClient
