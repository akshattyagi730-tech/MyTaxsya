import express from "express";
import {
  listEntities,
  getEntity,
  createEntity,
  updateEntity,
  deleteEntity
} from "../controllers/entityController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

// Protect all entity CRUD operations
router.use(protect);

router.get("/:entityName", listEntities);
router.get("/:entityName/:id", getEntity);
router.post("/:entityName", createEntity);
router.put("/:entityName/:id", updateEntity);
router.delete("/:entityName/:id", deleteEntity);

export default router;
