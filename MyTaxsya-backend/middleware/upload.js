import multer from "multer";

// Configure Memory Storage (processes buffers directly in memory)
const storage = multer.memoryStorage();

// Allowed file extensions & mime types for document extraction
const ALLOWED_EXTENSIONS = /\.(pdf|png|jpg|jpeg|csv|xlsx|xls|zip|txt|webp)$/i;
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
  "text/plain",
  "application/octet-stream" // General fallback for binary files/zips
];

// File Filter Function
const fileFilter = (req, file, cb) => {
  const extValid = ALLOWED_EXTENSIONS.test(file.originalname);
  const mimeValid = ALLOWED_MIME_TYPES.includes(file.mimetype) || file.mimetype.startsWith("image/");

  if (extValid || mimeValid) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Unsupported file type '${file.originalname}'. Supported formats: PDF, PNG, JPG, JPEG, WEBP, CSV, XLSX, ZIP.`
      ),
      false
    );
  }
};

// Multer Upload Instance with 100MB File Size Limit
export const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB Limit
    files: 20 // Support up to 20 files per batch upload
  },
  fileFilter
});

// Middleware Wrapper to handle Multer upload errors gracefully
export const handleMulterUpload = (fieldname = "file", isArray = false) => {
  return (req, res, next) => {
    const uploadHandler = isArray ? upload.array(fieldname, 20) : upload.single(fieldname);

    uploadHandler(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        console.error("Multer error during upload:", err);
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            error: "File size exceeds the 100 MB limit. Please upload a smaller file or split your batch.",
            code: "PAYLOAD_TOO_LARGE"
          });
        }
        if (err.code === "LIMIT_FILE_COUNT") {
          return res.status(400).json({
            error: "Too many files uploaded in a single request. Maximum allowed is 20 files.",
            code: "TOO_MANY_FILES"
          });
        }
        return res.status(400).json({
          error: `Upload error: ${err.message}`,
          code: err.code
        });
      } else if (err) {
        console.error("Custom upload error:", err.message);
        return res.status(400).json({
          error: err.message || "An error occurred during file upload",
          code: "INVALID_FILE"
        });
      }
      next();
    });
  };
};
