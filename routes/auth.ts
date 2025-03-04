import 'bun';
import express from "express";
import jwt from "jsonwebtoken";
import  {Dev}  from "../models/dev";
import { hash, verify } from "../utils/hash";
import  {check}  from '../middleware/auth';
import { Quick } from '../models/quick';
import { generatePasscode } from '../utils/key_maker';
import { send } from '../middleware/emailer';
import { Website } from '../models/website';
import { Metric } from '../models/metric';
interface AuthRequest extends express.Request { user?: { id: string; username: string }}
const router = express.Router();

// **Signup**
router.post("/signup", async (req, res):Promise<void>=> {
  try {
    const { username, firstname,email,lastname, password } = req.body;
    if (!username || !password)  {
      res.status(400).json({ error: "Missing required fields" });
      return }

    const exists = await Dev.findOne({ username });
  if (exists)  {
    res.status(409).json({ error: "Username already taken" });
    return }

    const hashed = await hash(password);
    const newUser = new Dev({ username, firstname, lastname, password: hashed, email });
    await newUser.save();

    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
// **Signin**
router.post("/signin", async (req, res): Promise<void> => {
  try {
    const { username, email, password } = req.body;
    if (!(username || (email && password))) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    // Check if it's username or email being passed
    let user = await Dev.findOne({ $or: [{ username }, { email }] });
    
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const isValid = await verify(password, user.password);
    if (!isValid) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const token = jwt.sign({ id: user._id, username: user.username},
      process.env.SAUCE || "chubingo", { expiresIn: "1d" });

    if(user.password) user.password= '';

    if(!user.authorized){
      const code = generatePasscode();
      await send(user.email, code);
      const quick = new Quick({
        email:user.email,
        passcode:code
      });
      await quick.save();
      res.status(200).json({user:"twoauth" });
    }
    const web = await Website.find({dev:user._id});

    res.cookie("Authorization", `Bearer ${token}`, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });
    res.status(200).json({ user, web });
  } catch (error) {
    console.error("Signin Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// **TwoAuth**
router.post('/twoauth', async(req,res):Promise<void>=>{
  try {
    const { email, passcode } = req.body;
    if ( !email && !passcode) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }
    // Check if it's username or email being passed
    let found = await Quick.findOneAndDelete({email:email});
    
    if (!found) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const num = Number(passcode);
    if (found.passcode !== num) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    let user = await Dev.findOne({email});
    if (!user) {
      res.status(404).json({message:'user does not exist'});
      return;
    }
    const token = jwt.sign({ id: user._id, username: user.username},
      process.env.SAUCE || "chubingo", { expiresIn: "1d" });

      user.authorized = true;
      await user.save();
    if(user.password) user.password= '';
    res.cookie("Authorization", `Bearer ${token}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.status(200).json({ token, user });
  } catch (error) {
    console.error("Signin Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
})
// **User Edit**
router.put("/user", check, async (req, res):Promise<void> => {
  try {
    const { username, firstname, lastname,email, img, password } = req.body;
    console.log(req.body);
    if (!username) {
      res.status(400).json({ error: "Username required" });
     return };

    let user = await Dev.findOne({ username:username });
    console.log(user);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return };
      const hashed = password ? await hash(password) : user.password;
    if(!user.password){
      res.status(404).json({ error: "User not found" });
      return;
    }
    user.firstname = firstname || user.firstname;
    user.lastname = lastname || user.lastname;
    user.email = email || user.email;
    user.img_url = img || user.img_url;
    user.password = hashed || user.password;
    user.modified_at = new Date();
    await user.save();
    res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});
router.delete("/user", check, async (req, res): Promise<void> => {
  try {
    const  username  = req.body;
    if (!username) {
      res.status(400).json({ error: "Username required" });
      return;
    }

    const user = await Dev.findOne({ username });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Fetch all websites related to this user
    const websites = await Website.find({ dev: user._id });

    // Delete all related data concurrently
    await Promise.all(websites.map(async (website) => {
      await Metric.deleteMany({ unique_key: website.unique_key });
      await Website.deleteOne({ unique_key: website.unique_key });
    }));

    // Finally, delete the user
    await Dev.deleteOne({ username:username });

    res.status(200).json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


export default router;