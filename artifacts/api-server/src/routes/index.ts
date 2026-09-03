import { Router, type IRouter } from "express";
import healthRouter from "./health";
import waslaRouter from "./wasla";

const router: IRouter = Router();

router.use(healthRouter);
router.use(waslaRouter);

export default router;
